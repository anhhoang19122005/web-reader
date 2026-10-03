// Run in a disposable CLI browser with serviceWorkers: "block".
// All API calls are fulfilled locally: no real books, TTS or progress writes.
// eslint-disable-next-line @typescript-eslint/no-unused-expressions
async (page) => {
  const assert = (ok, message) => { if (!ok) throw new Error(message); };
  const ids = ["brown", "white", "pink", "fan", "rain", "wind", "waves", "stream"];
  let preferences = { sound: "brown", ambientVolume: 0.1, font: "sans" };
  let disconnected = false;
  let generated = 0;
  const patches = [];
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => {
    window.__ambientProbe = { contexts: [], gains: [], sources: [] };
    const Base = window.AudioContext;
    window.AudioContext = class extends Base {
      constructor(...args) { super(...args); window.__ambientProbe.contexts.push(this); }
      createGain() { const node = super.createGain(); window.__ambientProbe.gains.push(node); return node; }
      createBufferSource() {
        const node = super.createBufferSource();
        node.__disconnected = false;
        const disconnect = node.disconnect.bind(node);
        node.disconnect = (...args) => { node.__disconnected = true; return disconnect(...args); };
        window.__ambientProbe.sources.push(node);
        return node;
      }
    };
  });
  const book = { id: "ambient-test", title: "Sách thử âm nền", author: "Test", chapters: [
    { id: "first", chapterNumber: 1, title: "Chương một" },
    { id: "second", chapterNumber: 2, title: "Chương hai" }
  ] };
  const mockApi = async (route) => {
    const path = "/api" + route.request().url().split("/api")[1].split("?")[0];
    const json = (value) => route.fulfill({ json: value });
    if (path === "/api/reader/preferences") {
      if (disconnected) return route.abort();
      if (route.request().method() === "PATCH") {
        const patch = route.request().postDataJSON(); patches.push(patch);
        preferences = { ...preferences, ...patch };
      }
      return json({ preferences, updatedAt: null });
    }
    if (path === "/api/books") return json([book]);
    if (path === "/api/books/ambient-test") return json(book);
    if (path.includes("/chapters/")) return json({ ...book.chapters.find((chapter) => path.endsWith(chapter.id)), plainText: "Một trang sách dùng để kiểm thử âm nền.\nKhông có dữ liệu cá nhân." });
    if (path.includes("/bookmarks/")) return json([]);
    if (path.includes("/progress/")) return json({ chapterId: null, characterPosition: 0 });
    if (path === "/api/tts/voices") return json([{ id: "test-voice", provider: "edge", name: "Giọng kiểm thử", language: "vi" }]);
    if (path.startsWith("/api/tts/chunks/")) return json([{ chunkIndex: 0, text: "Thử", startCharacter: 0, endCharacter: 3 }]);
    if (path === "/api/tts/generate") generated++;
    return route.fulfill({ status: 404, json: { message: "Fixture only" } });
  };
  await page.route("**/api/**", mockApi);
  await page.goto("http://localhost:3000/reader/ambient-test/first");
  await page.getByRole("button", { name: "Đọc", exact: true }).waitFor();
  await page.getByRole("button", { name: "Tùy chỉnh chữ và không gian", exact: true }).first().click();
  const select = page.getByLabel("Loại âm nền");
  assert(JSON.stringify(await select.locator("option").evaluateAll((options) => options.map((option) => option.value))) === JSON.stringify(ids), "All eight sounds must be available");
  for (const id of ids) await select.selectOption(id);
  assert(await page.evaluate(() => window.__ambientProbe.contexts.length === 0), "Selecting while disabled must not create audio");
  await page.getByRole("button", { name: "Bật âm nền", exact: true }).click();
  await page.waitForFunction(() => window.__ambientProbe.gains[0]?.gain.value > 0.095);
  const levels = {};
  for (const id of ids) {
    const before = await page.evaluate(() => window.__ambientProbe.sources.length);
    await select.selectOption(id);
    await page.waitForFunction((count) => window.__ambientProbe.sources.length > count && window.__ambientProbe.gains.at(-1)?.gain.value > 0.99 && window.__ambientProbe.sources.filter((source) => !source.__disconnected).length === 1, before);
    levels[id] = await page.evaluate(() => {
      const source = window.__ambientProbe.sources.at(-1);
      const samples = source.buffer.getChannelData(0);
      let peak = 0, energy = 0, delta = 0;
      for (let i = 0; i < samples.length; i++) {
        peak = Math.max(peak, Math.abs(samples[i])); energy += samples[i] ** 2;
        if (i) delta += (samples[i] - samples[i - 1]) ** 2;
      }
      const offset = Math.round(source.loopStart * source.buffer.sampleRate);
      const seam = Math.abs(samples.at(-1) - samples[offset]);
      return { peak, rms: Math.sqrt(energy / samples.length), roughness: Math.sqrt(delta / energy), seam, channels: source.buffer.numberOfChannels };
    });
    assert(levels[id].peak <= 0.801 && levels[id].rms > 0.1 && levels[id].rms <= 0.161 && levels[id].channels === 1, `${id}: bounded, comparable mono level`);
    assert(levels[id].seam <= 0.8, `${id}: seam must not exceed signal peak`);
  }
  assert(levels.brown.roughness < levels.pink.roughness && levels.pink.roughness < levels.white.roughness, "Noise colors must have distinct spectral texture");
  assert(await page.evaluate(() => window.__ambientProbe.contexts.length === 1), "Switches must reuse one AudioContext");
  for (const id of ["wind", "rain", "fan", "pink", "waves", "stream"]) {
    await select.selectOption(id);
    assert(await page.evaluate(() => window.__ambientProbe.sources.filter((source) => !source.__disconnected).length <= 2), "Rapid switches must not accumulate sources");
  }
  await page.waitForFunction(() => window.__ambientProbe.sources.filter((source) => !source.__disconnected).length === 1);
  assert(generated === 0, "Selecting ambience must never generate TTS");
  await page.locator("audio").dispatchEvent("playing");
  await page.waitForFunction(() => window.__ambientProbe.gains[0].gain.value < 0.035);
  await page.locator("audio").dispatchEvent("waiting");
  await page.waitForFunction(() => window.__ambientProbe.gains[0].gain.value > 0.095);
  const afterSpeechEvent = generated; // The simulated TTS playing event may prefetch its own chunk.
  await page.getByLabel("Âm lượng nền").fill("0");
  await page.waitForFunction(() => window.__ambientProbe.gains[0].gain.value === 0);
  await page.getByLabel("Âm lượng nền").fill("0.1");
  await select.selectOption("white");
  await page.getByRole("button", { name: "Tắt âm nền", exact: true }).click();
  await page.waitForFunction(() => window.__ambientProbe.contexts.every((context) => context.state === "closed") && window.__ambientProbe.sources.every((source) => source.__disconnected));
  await select.selectOption("stream");
  await page.getByRole("button", { name: "Bật âm nền", exact: true }).click();
  await page.waitForFunction(() => window.__ambientProbe.contexts.at(-1).state === "running");
  await page.evaluate(() => { Object.defineProperty(document, "hidden", { configurable: true, value: true }); document.dispatchEvent(new Event("visibilitychange")); });
  await page.waitForFunction(() => window.__ambientProbe.contexts.at(-1).state === "suspended");
  await page.evaluate(() => { delete document.hidden; document.dispatchEvent(new Event("visibilitychange")); });
  await page.waitForFunction(() => window.__ambientProbe.contexts.at(-1).state === "running");
  await page.getByRole("button", { name: "Đóng tùy chỉnh", exact: true }).click();
  await page.getByRole("button", { name: /Chương sau/ }).click();
  await page.waitForURL("**/second");
  assert(await page.evaluate(() => window.__ambientProbe.contexts.length === 2 && window.__ambientProbe.contexts[1].state === "running"), "Ambience must survive chapters");
  await page.getByRole("button", { name: "Tùy chỉnh chữ và không gian", exact: true }).first().click();
  disconnected = true;
  await select.selectOption("wind");
  await page.waitForFunction(() => JSON.parse(localStorage.getItem("gac-sach-preferences")).state.pending.sound === "wind");
  await page.reload();
  await page.getByRole("button", { name: "Tùy chỉnh chữ và không gian", exact: true }).first().click();
  assert(await select.inputValue() === "wind", "Offline choice must survive reload");
  assert(await page.evaluate(() => window.__ambientProbe.contexts.length === 0), "Reload must stay silent");
  disconnected = false;
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await page.waitForFunction(() => !JSON.parse(localStorage.getItem("gac-sach-preferences")).state.pending.sound);
  assert(preferences.sound === "wind" && preferences.font === "sans", "Reconnect must sync only changed fields");
  const secondPage = await page.context().newPage();
  await secondPage.route("**/api/**", mockApi);
  await secondPage.goto("http://localhost:3000/reader/ambient-test/first");
  await secondPage.getByRole("button", { name: "Tùy chỉnh chữ và không gian", exact: true }).first().click();
  await secondPage.getByLabel("Loại âm nền").selectOption("pink");
  await secondPage.waitForFunction(() => !JSON.parse(localStorage.getItem("gac-sach-preferences")).state.pending.sound);
  assert(preferences.sound === "pink", "Second browser page must sync its selection");
  await secondPage.close();
  await page.bringToFront();
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await page.waitForFunction(() => document.querySelector('[aria-label="Loại âm nền"]').value === "pink");
  await page.setViewportSize({ width: 390, height: 844 });
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), "Mobile controls must not overflow");
  await page.getByRole("button", { name: "Bật âm nền", exact: true }).click();
  await page.getByRole("button", { name: "Đóng tùy chỉnh", exact: true }).click();
  await page.getByRole("link", { name: "Gác Sách", exact: true }).click();
  await page.waitForFunction(() => window.__ambientProbe.contexts.every((context) => context.state === "closed"));
  assert(generated === afterSpeechEvent, "Ambient controls must not add TTS requests");
  assert(errors.length === 0, `Browser errors: ${errors.join(", ")}`);
  return { result: "PASS: 8 sounds, bounded levels, transitions, ducking, mute, lifecycle, offline sync, remote refresh and mobile", levels, patches: patches.length };
}
