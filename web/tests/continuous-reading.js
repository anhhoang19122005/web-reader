// Run with web dev server: playwright-cli run-code --filename web/tests/continuous-reading.js
// eslint-disable-next-line @typescript-eslint/no-unused-expressions
async (page) => {
  const assert = (condition, message) => { if (!condition) throw new Error(message); };
  const chapters = ["first", "second", "third"].map((id, i) => ({ id, title: `Chương ${i + 1}`, chapterNumber: i + 1 }));
  const requests = [];
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
    if (path.endsWith("/tts/voices")) return json([{ id: "test-voice", provider: "edge", name: "Giọng kiểm thử", language: "vi" }]);
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
  await page.getByLabel("Tốc độ phát lại", { exact: true }).selectOption("1.25");
  await page.getByLabel("Tốc độ", { exact: true }).fill("1.2");
  await page.getByLabel("Cao độ", { exact: true }).fill("3");
  await page.getByLabel("Âm lượng", { exact: true }).fill("0.4");
  await page.getByRole("button", { name: "▶ Đọc", exact: true }).click();
  await page.waitForFunction(() => { const a = document.querySelector("audio"); return a && !a.paused && a.readyState >= 2; });
  await page.locator("audio").dispatchEvent("ended");
  await page.waitForURL("**/second");
  await page.waitForFunction(() => { const a = document.querySelector("audio"); return a && !a.paused && a.readyState >= 2; });
  assert(requests[1].voiceId === requests[0].voiceId, "Voice must survive chapter navigation");
  assert(requests[1].speakingRate === 1.2 && requests[1].pitch === 3, "Synthesis settings must survive navigation");
  assert(await page.locator("audio").evaluate((a) => a.volume === 0.4), "Volume must survive navigation");
  assert(await page.locator("audio").evaluate((a) => a.playbackRate === 1.25), "Playback rate must survive navigation");
  await page.getByRole("button", { name: "■ Dừng", exact: true }).click();
  await page.locator("audio").dispatchEvent("ended");
  assert(page.url().endsWith("/second"), "Stop must prevent chapter advancement");
  assert(await page.locator("audio").evaluate((a) => a.paused), "Stop must pause audio");
  await page.getByRole("button", { name: "▶ Đọc", exact: true }).click();
  await page.waitForFunction(() => !document.querySelector("audio").paused);
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
  return "PASS: continuous chapters, preserved voice/settings, stop, delayed request, final chapter, reload, typography";
}
