// playwright-cli run-code --filename web/tests/reader-follow.js
// Mock API and audio: no real book or progress is modified.
// eslint-disable-next-line @typescript-eslint/no-unused-expressions
async (page) => {
  const assert = (value, message) => { if (!value) throw new Error(message); };
  const before = ("An earlier paragraph with several lines of text. ".repeat(8) + "\n\n").repeat(20);
  const passage = ("The currently spoken passage crosses paragraph boundaries. ".repeat(3) + "\n\n").repeat(3);
  const text = before + passage + before;
  const chunk = { chunkIndex: 0, text: passage, startCharacter: before.length, endCharacter: before.length + passage.length };
  const chapter = { id: "first", title: "Follow regression", chapterNumber: 1 };
  const wav = new Uint8Array(44 + 8000 * 60);
  const header = new DataView(wav.buffer);
  const write = (value, offset) => [...value].forEach((letter, index) => { wav[offset + index] = letter.charCodeAt(0); });
  write("RIFF", 0); header.setUint32(4, wav.length - 8, true); write("WAVEfmt ", 8);
  header.setUint32(16, 16, true); header.setUint16(20, 1, true); header.setUint16(22, 1, true);
  header.setUint32(24, 8000, true); header.setUint32(28, 8000, true); header.setUint16(32, 1, true); header.setUint16(34, 8, true);
  write("data", 36); header.setUint32(40, wav.length - 44, true); wav.fill(128, 44);
  const audioBody = [...wav].map((byte) => String.fromCharCode(byte)).join("");
  await page.route("**/api/**", (route) => {
    const path = route.request().url().split("/api")[1];
    const json = (data) => route.fulfill({ json: data });
    if (path === "/reader/preferences") return json({ preferences: null, updatedAt: null });
    if (path === "/books/follow-test") return json({ id: "follow-test", title: "Follow test", chapters: [chapter] });
    if (path.endsWith("/chapters/first")) return json({ ...chapter, plainText: text });
    if (path.includes("/progress/")) return json({ bookId: "follow-test", chapterId: "first", characterPosition: 0 });
    if (path.includes("/bookmarks/")) return json([]);
    if (path === "/tts/voices") return json([{ id: "test", provider: "edge", name: "Test", language: "en" }]);
    if (path.includes("/tts/chunks/")) return json([chunk]);
    if (path === "/tts/generate") return json({ audioUrl: "/follow.wav", durationMs: 60000, cached: true });
    return json([]);
  });
  await page.route("**/follow.wav", (route) => route.fulfill({ contentType: "audio/wav", body: audioBody }));
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("http://localhost:3000/reader/follow-test/first");
  await page.getByRole("button", { name: "Đọc", exact: true }).click();
  await page.waitForFunction(() => document.querySelectorAll(".reading-highlight").length >= 3);
  await page.waitForTimeout(1100);
  const following = () => page.getByRole("button", { name: "Bám theo đoạn đọc", exact: true }).getAttribute("aria-pressed");
  const fullyVisible = () => page.evaluate(() => {
    const rects = [...document.querySelectorAll(".reading-highlight")].flatMap((node) => [...node.getClientRects()]).filter((rect) => rect.height);
    return Math.min(...rects.map((r) => r.top)) >= document.querySelector(".reader-dock").getBoundingClientRect().bottom && Math.max(...rects.map((r) => r.bottom)) <= innerHeight - 24;
  });
  assert(await fullyVisible(), "Full multi-paragraph passage must fit below the player");
  assert(await following() === "true", "Automatic scrolling must keep following enabled");
  await page.locator(".reading-highlight").first().dispatchEvent("pointerdown");
  assert(await following() === "true", "Text selection must not disable following");
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
  await page.waitForTimeout(200);
  assert(await page.getByRole("button", { name: "Đã dừng bám theo", exact: true }).getAttribute("aria-pressed") === "false", "Native page scrolling must pause following");
  await page.getByRole("button", { name: "Đã dừng bám theo", exact: true }).evaluate((button) => button.click());
  await page.waitForTimeout(1100);
  assert(await fullyVisible(), "Re-enabling follow must immediately restore the entire current passage");
  await page.setViewportSize({ width: 390, height: 360 });
  await page.waitForTimeout(1100);
  assert(await following() === "true", "Viewport changes must preserve following");
  assert(await page.locator(".reading-highlight").first().evaluate((node) => Math.abs(node.getBoundingClientRect().top - document.querySelector(".reader-dock").getBoundingClientRect().bottom - 20) < 5), "Oversized passages must show their beginning below the player");
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.waitForTimeout(1100);
  assert(await fullyVisible(), "Resizing back must show the full passage again");
  await page.mouse.wheel(0, 400);
  await page.waitForTimeout(200);
  assert(await page.getByRole("button", { name: "Đã dừng bám theo", exact: true }).count() === 1, "Wheel scrolling must pause following");
  return "PASS: multi-paragraph visibility, smooth automatic scrollbar sync, text selection, manual scroll pause, immediate resume, mobile oversized passage, resize, wheel pause";
}
