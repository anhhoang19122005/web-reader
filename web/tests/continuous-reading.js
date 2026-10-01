// Run with web dev server: playwright-cli run-code --filename web/tests/continuous-reading.js
// eslint-disable-next-line @typescript-eslint/no-unused-expressions
async (page) => {
  const assert = (condition, message) => { if (!condition) throw new Error(message); };
  const chapters = ["first", "second", "third"].map((id, i) => ({ id, title: `Chương ${i + 1}`, chapterNumber: i + 1 }));
  const requests = [];
  await page.addInitScript(() => {
    if (window.__ambientProbe?.gains) return;
    window.__ambientProbe = { contexts: [], gains: [], sources: [] };
    const Base = window.AudioContext;
    window.AudioContext = class extends Base {
      constructor(...args) { super(...args); window.__ambientProbe.contexts.push(this); }
      createGain() { const gain = super.createGain(); window.__ambientProbe.gains.push(gain); return gain; }
      createBufferSource() { const source = super.createBufferSource(); window.__ambientProbe.sources.push(source); return source; }
    };
  });
  let delayGeneration = false;
  let release;
  // ASCII-safe WAV fixture for the CLI sandbox (no Node Buffer available).
  const wav = new Uint8Array(44 + 65536);
  const header = new DataView(wav.buffer);
  const write = (text, offset) => [...text].forEach((c, i) => { wav[offset + i] = c.charCodeAt(0); });
  write("RIFF", 0); header.setUint32(4, wav.length - 8, true); write("WAVEfmt ", 8);
  header.setUint32(16, 16, true); header.setUint16(20, 1, true); header.setUint16(22, 1, true);
  header.setUint32(24, 8000, true); header.setUint32(28, 8000, true); header.setUint16(32, 1, true);
  header.setUint16(34, 8, true); write("data", 36); header.setUint32(40, 65536, true); wav.fill(127, 44);
  const audioBody = [...wav].map((b) => String.fromCharCode(b)).join("");
  await page.route("**/api/**", async (route) => {
    const path = route.request().url().split("/api")[1];
    const json = (data) => route.fulfill({ json: data });
    if (path.endsWith("/tts/voices")) return json([{ id: "test-voice", provider: "edge", name: "Giọng kiểm thử", language: "vi" }, { id: "vieneu-thien-tam-duc", provider: "vieneu", name: "Thiền Tâm Đức", language: "vi" }]);
    if (path.includes("/tts/chunks/")) return json([{ chunkIndex: 0, text: "Tiếng Việt", startCharacter: 0, endCharacter: 10 }]);
    if (path.endsWith("/tts/generate")) {
      requests.push(route.request().postDataJSON());
      if (delayGeneration) await new Promise((resolve) => { release = resolve; });
      return json({ audioUrl: "/test.wav", cached: true });
    }
    if (path.endsWith("/test.wav")) return route.fulfill({ contentType: "audio/wav", body: audioBody });
    if (path.endsWith("/books/continuous-test")) return json({ id: "continuous-test", title: "Kiểm thử", author: "Test", chapters });
    if (path.includes("/chapters/")) return json({ ...chapters.find((c) => path.endsWith(c.id)), plainText: "Tiếng Việt  không bị giãn chữ.\nDòng thứ hai." });
    if (path.includes("/bookmarks/")) return json([]);
    if (path.includes("/progress/")) return json({ chapterId: null, characterPosition: 0 });
    return route.continue();
  });
  await page.goto("http://localhost:3000/reader/continuous-test/first");
  await page.getByRole("button", { name: "▶ Đọc", exact: true }).waitFor();
  assert(requests.length === 0, "Opening a chapter must not generate audio");
  assert(await page.locator(".player-settings").evaluate((el) => !el.open), "Settings start collapsed");
  assert(await page.evaluate(() => window.__ambientProbe.contexts.length === 0), "Opening Reader must not create audio context");
  await page.locator(".player-settings summary").click();
  await page.getByRole("button", { name: "Bật âm nền", exact: true }).click();
  await page.waitForFunction(() => window.__ambientProbe.gains.at(-1)?.gain.value > 0.095);
  await page.locator("audio").dispatchEvent("playing");
  await page.waitForFunction(() => window.__ambientProbe.gains.at(-1)?.gain.value < 0.035);
  await page.locator("audio").dispatchEvent("waiting");
  await page.waitForFunction(() => window.__ambientProbe.gains.at(-1)?.gain.value > 0.095);
  await page.getByLabel("Loại âm nền").selectOption("rain");
  await page.waitForFunction(() => window.__ambientProbe.sources.length === 2);
  assert(await page.evaluate(() => window.__ambientProbe.contexts.length === 1), "Changing ambience must reuse one audio context");
  await page.getByRole("button", { name: "Tối", exact: true }).click();
  await page.waitForFunction(() => document.documentElement.dataset.theme === "dark");
  await page.getByRole("button", { name: "Giấy", exact: true }).click();
  await page.getByLabel("Tốc độ phát lại", { exact: true }).selectOption("1.25");
  await page.getByLabel("Tốc độ", { exact: true }).fill("1.2");
  await page.getByLabel("Cao độ", { exact: true }).fill("3");
  await page.getByLabel("Âm lượng", { exact: true }).fill("0.4");
  await page.getByRole("button", { name: "▶ Đọc", exact: true }).click();
  await page.waitForFunction(() => { const a = document.querySelector("audio"); return a && !a.paused && a.readyState >= 2; });
  await page.locator("audio").dispatchEvent("ended");
  await page.waitForURL("**/second");
  await page.waitForFunction(() => { const a = document.querySelector("audio"); return a && !a.paused && a.readyState >= 2; });
  assert(await page.evaluate(() => window.__ambientProbe.contexts.length === 1 && window.__ambientProbe.contexts[0].state === "running"), "Ambience must survive chapter changes");
  assert(requests[1].voiceId === requests[0].voiceId, "Voice must survive chapter navigation");
  assert(requests[1].speakingRate === 1.2 && requests[1].pitch === 3, "Synthesis settings must survive navigation");
  assert(await page.locator("audio").evaluate((a) => a.volume === 0.4), "Volume must survive navigation");
  assert(await page.locator("audio").evaluate((a) => a.playbackRate === 1.25), "Playback rate must survive navigation");
  await page.getByRole("button", { name: "■ Dừng", exact: true }).click();
  await page.locator("audio").dispatchEvent("ended");
  assert(page.url().endsWith("/second"), "Stop must prevent chapter advancement");
  assert(await page.locator("audio").evaluate((a) => a.paused), "Stop must pause audio");
  const beforeReplay = requests.length;
  await page.getByRole("button", { name: "▶ Đọc", exact: true }).click();
  await page.waitForFunction(() => !document.querySelector("audio").paused);
  assert(requests.length === beforeReplay, "Replaying cached audio must not generate again");
  delayGeneration = true;
  await page.locator("audio").dispatchEvent("ended");
  await page.waitForURL("**/third");
  await page.getByRole("button", { name: "Đang tạo…", exact: true }).waitFor();
  await page.getByRole("button", { name: "■ Dừng", exact: true }).click();
  delayGeneration = false;
  release();
  await page.waitForResponse((r) => r.url().endsWith("/tts/generate"));
  assert(await page.locator("audio").evaluate((a) => a.paused && !a.getAttribute("src")), "Stopped request must not start audio later");
  await page.getByRole("button", { name: "▶ Đọc", exact: true }).click();
  await page.waitForFunction(() => !document.querySelector("audio").paused);
  await page.locator("audio").dispatchEvent("ended");
  await page.waitForFunction(() => [...document.querySelectorAll("button")].some((b) => b.textContent === "■ Dừng" && b.disabled));
  assert(page.url().endsWith("/third"), "Final chapter must finish without navigation");
  const style = await page.locator(".reader-text").evaluate((el) => ({ font: getComputedStyle(el).fontFamily, whiteSpace: getComputedStyle(el).whiteSpace, text: el.textContent }));
  assert(style.font.startsWith("Arial") && style.whiteSpace === "pre-line", "Reader typography must use consistent Vietnamese font and collapsed spaces");
  assert(style.text.includes("  "), "Typography fix must preserve source text");
  await page.reload();
  await page.getByRole("button", { name: "▶ Đọc", exact: true }).waitFor();
  assert(await page.locator("audio").evaluate((a) => !a.getAttribute("src")), "Reload must not autoplay");
  await page.locator(".player-settings summary").click();
  assert(await page.evaluate(() => window.__ambientProbe.contexts.length === 0), "Reload must keep ambience silent");
  assert(await page.getByLabel("Loại âm nền").inputValue() === "rain", "Ambient preference must survive reload");
  await page.getByLabel("Nhà cung cấp giọng đọc").selectOption("vieneu");
  assert(await page.getByLabel("Tốc độ", { exact: true }).isDisabled(), "VieNeu ignores synthesis rate");
  assert(await page.getByLabel("Cao độ", { exact: true }).isDisabled(), "VieNeu ignores pitch");
  await page.getByRole("button", { name: "▶ Đọc", exact: true }).click();
  await page.waitForFunction(() => !document.querySelector("audio").paused);
  const last = requests[requests.length - 1];
  assert(last.voiceId === "vieneu-thien-tam-duc" && last.speakingRate === 1 && last.pitch === 0, "VieNeu must use fixed synthesis settings");
  await page.getByRole("button", { name: "■ Dừng", exact: true }).click();
  await page.getByRole("button", { name: "Bật âm nền", exact: true }).click();
  await page.getByRole("link", { name: "Gác Sách", exact: true }).click();
  await page.waitForURL("**/library/continuous-test");
  await page.waitForFunction(() => window.__ambientProbe.contexts.every((ctx) => ctx.state === "closed"));
  // Two chunks: foreground navigation must reuse an in-flight prefetch.
  const generated = [];
  let finishPrefetch;
  let delayOnce = true;
  await page.route("**/api/tts/chunks/first", (route) => route.fulfill({ json: [
    { chunkIndex: 0, text: "Đoạn đầu", startCharacter: 0, endCharacter: 8 },
    { chunkIndex: 1, text: "Đoạn sau", startCharacter: 8, endCharacter: 16 },
  ] }));
  await page.route("**/api/tts/generate", async (route) => {
    const payload = route.request().postDataJSON();
    generated.push(payload);
    if (payload.chunkIndex === 1 && delayOnce) {
      delayOnce = false;
      await new Promise((resolve) => { finishPrefetch = resolve; });
    }
    return route.fulfill({ json: { audioUrl: "/test.wav", cached: true } });
  });
  await page.goto("http://localhost:3000/reader/continuous-test/first");
  await page.reload();
  await page.getByRole("button", { name: "▶ Đọc", exact: true }).waitFor();
  const prefetch = page.waitForRequest((r) => r.url().endsWith("/tts/generate") && r.postDataJSON().chunkIndex === 1);
  await page.getByRole("button", { name: "▶ Đọc", exact: true }).click();
  await prefetch;
  await page.getByRole("button", { name: "Đoạn sau", exact: true }).click();
  await page.getByRole("button", { name: "Đang tạo…", exact: true }).waitFor();
  assert(generated.filter((r) => r.chunkIndex === 1).length === 1, "Pending prefetch must be deduplicated");
  finishPrefetch();
  await page.waitForFunction(() => !document.querySelector("audio").paused);
  await page.getByRole("button", { name: "Đoạn trước", exact: true }).click();
  await page.waitForFunction(() => !document.querySelector("audio").paused);
  assert(generated.filter((r) => r.chunkIndex === 0).length === 1, "Previous chunk must use query cache");
  await page.locator(".player-settings summary").click();
  await page.getByLabel("Nhà cung cấp giọng đọc").selectOption("vieneu");
  await page.getByRole("button", { name: "▶ Đọc", exact: true }).click();
  await page.waitForFunction(() => !document.querySelector("audio").paused);
  assert(generated.at(-1).voiceId === "vieneu-thien-tam-duc", "Changed voice must generate its own audio");
  await page.getByRole("button", { name: "■ Dừng", exact: true }).click();
  return "PASS: continuous reading, stop, settings, reload, typography, ambience lifecycle, cache, prefetch dedupe, voice changes";
}
