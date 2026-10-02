// playwright-cli run-code --filename web/tests/reader-upgrades.js
// All API requests are intercepted; no real progress or preferences are written.
// eslint-disable-next-line @typescript-eslint/no-unused-expressions
async (page) => {
  const assert = (value, message) => { if (!value) throw new Error(message); };
  const text = Array.from({ length: 90 }, (_, i) => (`Đoạn ${i}. Gió đi qua rừng xanh 🙂. Một câu chuyện với dấu tiếng Việt, và những khoảng lặng bên hiên nhà. `).repeat(3) + "\r\n\r\n").join("");
  const position = text.indexOf("Đoạn 30.");
  const chapters = [{ id: "first", title: "Chương 1 · Đoạn rừng", chapterNumber: 1 }, { id: "next", title: "Chương 2 · Bờ biển", chapterNumber: 2 }];
  const book = { id: "upgrade-test", title: "Reader upgrade test", author: "Test", chapters };
  let progress = { bookId: book.id, chapterId: "first", characterPosition: position };
  let preferences = null;
  let offline = false;
  let audioRequests = 0;
  let nextReads = 0;
  const writes = [];
  const patches = [];
  const wav = new Uint8Array(44 + 655360);
  const header = new DataView(wav.buffer);
  const write = (str, offset) => [...str].forEach((c, i) => { wav[offset + i] = c.charCodeAt(0); });
  write("RIFF", 0); header.setUint32(4, wav.length - 8, true); write("WAVEfmt ", 8);
  header.setUint32(16, 16, true); header.setUint16(20, 1, true); header.setUint16(22, 1, true);
  header.setUint32(24, 8000, true); header.setUint32(28, 8000, true); header.setUint16(32, 1, true); header.setUint16(34, 8, true);
  write("data", 36); header.setUint32(40, 655360, true); wav.fill(127, 44);
  const audioBody = [...wav].map((byte) => String.fromCharCode(byte)).join("");
  const attach = async (target) => target.route("**/api/**", async (route) => {
    const path = route.request().url().split("/api")[1];
    const json = (data) => route.fulfill({ json: data });
    if (path === "/reader/preferences") {
      if (offline) return route.abort();
      if (route.request().method() === "PATCH") { const patch = route.request().postDataJSON(); patches.push(patch); preferences = { ...(preferences ?? {}), ...patch }; }
      return json({ preferences, updatedAt: null });
    }
    if (path === "/books") return json([]);
    if (path === "/books/upgrade-test") return json(book);
    if (path.endsWith("/chapters/first")) return json({ ...chapters[0], plainText: text });
    if (path.endsWith("/chapters/next")) { nextReads++; return json({ ...chapters[1], plainText: "Chương kế tiếp, yên tĩnh bên biển." }); }
    if (path.includes("/progress/")) {
      if (route.request().method() === "PUT") {
        const value = route.request().postDataJSON(); writes.push(value);
        if (value.chapterId === "next" || (progress.chapterId === "first" && value.characterPosition > progress.characterPosition)) progress = { ...progress, ...value };
      }
      return json(progress);
    }
    if (path.includes("/bookmarks/")) return json([]);
    if (path === "/tts/voices") return json([{ id: "test", provider: "edge", name: "Giọng test", language: "vi" }]);
    if (path.includes("/tts/chunks/")) return json([{ chunkIndex: 0, text, startCharacter: 0, endCharacter: text.length }]);
    if (path === "/tts/generate") { audioRequests++; return json({ audioUrl: "/test.wav", durationMs: 81920, cached: true }); }
    if (path === "/test.wav") return route.fulfill({ contentType: "audio/wav", body: audioBody });
    throw new Error(`Unexpected mock API: ${path}`);
  });
  await attach(page);
  await page.addInitScript(() => {
    if (!localStorage.getItem("gac-sach-preferences")) localStorage.setItem("gac-sach-preferences", JSON.stringify({ state: { theme: "sepia", textStyle: "large", leaves: false, sound: "brown", ambientVolume: .1 }, version: 0 }));
  });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("http://localhost:3000/reader/upgrade-test/first");
  await page.getByRole("button", { name: "▶ Đọc", exact: true }).waitFor();
  await page.waitForFunction(() => getComputedStyle(document.querySelector(".reader-text")).fontSize === "24px");
  await page.waitForTimeout(1100);
  assert(await page.locator(".reader-text").textContent() === text, "UTF-16 source text, emoji and CRLF must be preserved");
  const charTop = () => page.evaluate((pos) => {
    const container = document.querySelector(".reader-text");
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      if (pos < node.length) { const range = document.createRange(); range.setStart(node, pos); range.setEnd(node, pos + 1); return range.getBoundingClientRect().top - (document.querySelector(".reader-dock").getBoundingClientRect().bottom + 20); }
      pos -= node.length;
    }
    return 99999;
  }, position);
  assert(Math.abs(await charTop()) < 45, "Existing progress must restore the correct paragraph");
  assert(writes.length === 0 && audioRequests === 0, "Restoration must not save progress or create audio");
  await page.locator(".player-settings summary").click();
  await page.getByLabel("Font chữ", { exact: true }).selectOption("serif");
  await page.getByLabel("Cỡ chữ", { exact: true }).fill("26");
  await page.getByLabel("Giãn dòng", { exact: true }).fill("2");
  await page.getByLabel("Độ rộng dòng", { exact: true }).selectOption("60");
  await page.waitForTimeout(1100);
  assert(Math.abs(await charTop()) < 60, "Typography changes must preserve the visible paragraph");
  assert(writes.length === 0, "Typography changes must not advance progress");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(1000);
  assert(Math.abs(await charTop()) < 60, "Resize must preserve the visible paragraph");
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "Mobile must not overflow");
  assert(writes.length === 0, "Resize must not write progress");
  await page.locator(".player-settings summary").click();
  await page.waitForTimeout(1000);
  await page.evaluate(() => {
    window.dispatchEvent(new WheelEvent("wheel", { deltaY: 1000 }));
    const paragraph = [...document.querySelectorAll("[data-start]")].find((node) => node.textContent.startsWith("Đoạn 75."));
    window.scrollTo({ top: scrollY + paragraph.getBoundingClientRect().top - document.querySelector(".reader-dock").getBoundingClientRect().bottom - 20, behavior: "instant" });
  });
  await page.waitForTimeout(1800);
  assert(writes.length > 0 && writes.at(-1).characterPosition > position, "Manual scroll must save actual character progress");
  assert(nextReads === 1 && audioRequests === 0, "70% prefetch must fetch only next chapter content once");
  await page.locator(".reader-text").dispatchEvent("click", { detail: 1 });
  await page.locator(".reader-text").dispatchEvent("click", { detail: 2 });
  await page.waitForTimeout(300);
  assert(await page.locator(".reader-focus").count() === 0, "Double click for selection must not toggle focus");
  await page.getByRole("button", { name: "▶ Đọc", exact: true }).click();
  await page.waitForFunction(() => !document.querySelector("audio").paused);
  await page.evaluate(() => { window.__heldAudio = document.querySelector("audio"); document.activeElement.blur(); });
  await page.keyboard.press("f");
  await page.waitForFunction(() => document.querySelector(".reader-focus"));
  assert(await page.locator("audio").evaluate((audio) => audio === window.__heldAudio && !audio.paused), "Focus must preserve playing audio element");
  assert(await page.locator(".falling-leaf").count() === 0, "Focus hides decorative effects");
  await page.screenshot({ path: ".reader-deploy/reader-focus-mobile.png", animations: "disabled" });
  await page.keyboard.press("Escape");
  await page.keyboard.press("t");
  await page.getByRole("dialog").waitFor();
  await page.getByLabel("Tìm chương").fill("doan rung");
  assert(await page.locator(".chapter-drawer .chapter-list li").count() === 1, "TOC search must ignore Vietnamese accents");
  await page.keyboard.press("ArrowRight");
  assert(page.url().endsWith("/first"), "Shortcut must not navigate while entering search");
  await page.keyboard.press("Escape");
  assert(await page.locator("audio").evaluate((audio) => !audio.paused), "Drawer must not interrupt TTS");
  await page.getByRole("button", { name: "Dừng đọc", exact: true }).click();
  await page.waitForFunction(() => document.querySelector("audio").paused);
  await page.evaluate(() => document.activeElement.blur());
  await page.keyboard.press("d");
  await page.waitForFunction(() => document.documentElement.dataset.theme === "dark");
  await page.keyboard.press("ArrowRight");
  await page.waitForURL("**/next");
  await page.getByRole("button", { name: "▶ Đọc", exact: true }).waitFor();
  assert(nextReads === 1, "Opening prefetched chapter must reuse query cache");

  // Two isolated browser contexts represent two devices sharing the mock API.
  const secondContext = await page.context().browser().newContext();
  const second = await secondContext.newPage();
  try {
    await attach(second);
    await second.goto("http://localhost:3000/reader/upgrade-test/next");
    await second.getByRole("button", { name: "▶ Đọc", exact: true }).waitFor();
    await second.locator(".player-settings summary").click();
    await second.waitForFunction(() => JSON.parse(localStorage.getItem("gac-sach-preferences")).state.fontSize === 26);
    await page.locator(".player-settings summary").click();
    await page.getByLabel("Font chữ", { exact: true }).selectOption("sans");
    await second.getByRole("button", { name: "Biển", exact: true }).click();
    await page.waitForTimeout(900);
    assert(preferences.font === "sans" && preferences.theme === "ocean", "Independent fields from two devices must both survive");
    assert(patches.at(-1).theme === "ocean" && !Object.hasOwn(patches.at(-1), "font"), "Theme patch must not contain unrelated font");
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await page.waitForFunction(() => document.documentElement.dataset.theme === "ocean");
    offline = true;
    await page.getByLabel("Cỡ chữ", { exact: true }).fill("28");
    await page.waitForTimeout(800);
    assert(await page.evaluate(() => JSON.parse(localStorage.getItem("gac-sach-preferences")).state.pending.fontSize === 28), "Offline changes must remain queued locally");
    await page.reload();
    await page.getByRole("button", { name: "▶ Đọc", exact: true }).waitFor();
    assert(await page.evaluate(() => JSON.parse(localStorage.getItem("gac-sach-preferences")).state.fontSize === 28), "Offline reload must retain changed font size");
    offline = false;
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    await page.waitForFunction(() => Object.keys(JSON.parse(localStorage.getItem("gac-sach-preferences")).state.pending).length === 0);
    assert(preferences.fontSize === 28 && preferences.theme === "ocean", "Reconnect must merge pending changes without reverting remote fields");
  } finally { await secondContext.close(); }
  return "PASS: UTF16 restore, legacy migration, typography/resize anchors, manual progress, content prefetch, focus/TTS, TOC/shortcuts, two-device sync, offline queue";
}
