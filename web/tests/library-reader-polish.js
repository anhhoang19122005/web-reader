// playwright-cli open about:blank with serviceWorkers: "block", then run-code this file.
// Every API request is mocked; real books/preferences are never touched.
// eslint-disable-next-line @typescript-eslint/no-unused-expressions
async (page) => {
  const assert = (value, message) => { if (!value) throw new Error(message); };
  const text = Array.from({ length: 100 }, (_, index) => (`Đoạn ${index}. Lá xanh và lời kể bên khung cửa. `).repeat(5) + "\n\n").join("");
  const chapters = [{ id: "one", title: "Chương 1 · Rừng", chapterNumber: 1 }, { id: "two", title: "Chương 2 · Biển", chapterNumber: 2 }];
  const book = { id: "polish-test", title: "Một cuốn sách thử", author: "Test", hasCover: true, chapterCount: 2, progressPercent: 60, lastReadAt: "2026-10-02", continueChapterId: "two", continueChapterNumber: 2, continueChapterTitle: chapters[1].title, chapters };
  let deleted = false;
  let preferences = { theme: "dark" };
  let bookmarks = Array.from({ length: 10 }, (_, i) => ({ id: `mark-${i}`, chapterId: i === 9 ? "two" : "one", characterPosition: i === 9 ? text.indexOf("Đoạn 40.") : 100+i, excerpt: `Trích đoạn yêu thích ${i}`, chapterTitle: chapters[i === 9 ? 1 : 0].title }));
  const writes = [];
  const imports = [];
  await page.addInitScript(() => { localStorage.setItem("gac-sach-preferences", JSON.stringify({ state: { theme: "dark" }, version: 0 })); });
  await page.route("**/api/**", async (route) => {
    const request = route.request(); const path = request.url().split("/api")[1];
    const json = (value) => route.fulfill({ json: value });
    if (path === "/reader/preferences") { if (request.method() === "PATCH") preferences = { ...preferences, ...request.postDataJSON() }; return json({ preferences, updatedAt: null }); }
    if (path === "/books") return json(deleted ? [] : [book]);
    if (path === "/books/polish-test" && request.method() === "DELETE") { deleted = true; return route.fulfill({ status: 204 }); }
    if (path === "/books/polish-test/restore") { deleted = false; return route.fulfill({ status: 204 }); }
    if (path === "/books/polish-test/cover") return route.fulfill({ contentType: "image/svg+xml", body: '<svg xmlns="http://www.w3.org/2000/svg" width="90" height="126"><rect width="90" height="126" fill="#3e593e"/></svg>' });
    if (path === "/books/polish-test") return json(book);
    if (path.includes("/chapters/")) return json({ ...chapters.find((chapter) => path.endsWith(chapter.id)), plainText: text });
    if (path.includes("/progress/")) { if (request.method() === "PUT") writes.push(request.postDataJSON()); return json({ chapterId: "one", characterPosition: 0 }); }
    if (path.startsWith("/reader/bookmarks/")) {
      if (request.method() === "POST") { const payload = request.postDataJSON(); bookmarks = [{ id:"new", ...payload, excerpt:"Đoạn vừa lưu", chapterTitle: chapters.find((chapter) => chapter.id === payload.chapterId).title }, ...bookmarks]; return json(bookmarks[0]); }
      if (request.method() === "DELETE") { bookmarks = bookmarks.filter((bookmark) => !path.endsWith(bookmark.id)); return route.fulfill({ status: 204 }); }
      return json(bookmarks);
    }
    if (path === "/tts/voices") return json([{ id: "test", provider:"edge", name:"Giọng thử", language:"vi" }]);
    if (path.startsWith("/tts/chunks/")) return json([{ chunkIndex:0, text:"Đoạn đầu", startCharacter:0, endCharacter:8 }]);
    if (path === "/tts/generate") throw new Error("This UI test must not generate audio");
    if (path === "/books/upload") { imports.push(request.postData()); await page.waitForTimeout(300); return json({ id:"imported" }); }
    throw new Error(`Unexpected API request: ${path}`);
  });
  await page.goto("http://localhost:3000/library");
  await page.getByRole("link", { name:"Đọc tiếp · Chương 2", exact:true }).waitFor();
  assert(await page.locator(".book-cover img").count() === 2, "Library must show actual cover images");
  assert(await page.evaluate(() => document.documentElement.dataset.theme) === "dark", "Saved theme must be applied");
  await page.getByRole("button", { name:`Xóa ${book.title}`, exact:true }).click();
  await page.getByRole("button", { name:"Hoàn tác", exact:true }).click();
  await page.getByRole("link", { name:"Đọc tiếp · Chương 2", exact:true }).waitFor();
  assert(!deleted, "Undo must restore the same book");
  await page.locator('input[type="file"]').evaluate((input) => { const transfer = new DataTransfer(); transfer.items.add(new File(["PK fake epub"],"test.epub",{ type:"application/epub+zip" })); transfer.items.add(new File(["A"],"invalid.txt",{type:"text/plain"})); input.files=transfer.files; input.dispatchEvent(new Event("change",{bubbles:true})); });
  await page.waitForFunction(() => document.querySelector(".upload-status").textContent.includes("Chỉ hỗ trợ"));
  assert(imports.length === 1, "Each supported upload must run once; unsupported file gets its own error");
  await page.locator(".shelf .book-link").click();
  await page.getByLabel("Tìm chương").fill("bien");
  assert(await page.locator(".chapter-list li").count() === 1, "Detail search ignores accents");
  await page.getByRole("link", { name:"Đọc tiếp · Chương 1", exact:true }).click();
  await page.getByRole("button", { name:"Đọc", exact:true }).waitFor();
  assert(await page.locator(".player-idle").count() === 1, "Unplayed player must be compact");
  await page.setViewportSize({ width:390, height:844 });
  assert((await page.locator(".reader-dock").boundingBox()).height < 90, "Idle mobile player must fit one row");
  await page.locator(".reader-text").dispatchEvent("click", { detail:1 });
  await page.waitForTimeout(300);
  assert(await page.locator(".reader-focus").count() === 0, "Touching text must not toggle focus");
  await page.getByRole("button", { name:"Tùy chỉnh chữ và không gian", exact:true }).first().click();
  await page.getByLabel("Font chữ", { exact:true }).selectOption("serif");
  await page.getByRole("button", { name:"Đóng tùy chỉnh", exact:true }).click();
  assert(await page.locator(".reader-text").evaluate((node) => getComputedStyle(node).fontFamily.includes("readerSerif")), "Reader uses the self-hosted serif font");
  await page.getByRole("button", { name:"10 dấu trang", exact:true }).click();
  assert(await page.locator(".bookmark-jump").count() === 10, "Drawer must show every bookmark");
  await page.getByRole("button", { name:/Trích đoạn yêu thích 9/ }).click();
  await page.waitForURL("**/two?position=*");
  await page.getByRole("button", { name:"Đọc", exact:true }).waitFor();
  await page.waitForTimeout(1000);
  assert(writes.length === 0, "Bookmark restoration must not write false progress");
  const position = text.indexOf("Đoạn 40.");
  const top = await page.locator(".reader-text").evaluate((node, position) => {
    const walker = document.createTreeWalker(node,NodeFilter.SHOW_TEXT); let part;
    while ((part=walker.nextNode())) { if (position < part.length) { const range=document.createRange(); range.setStart(part,position); range.setEnd(part,position+1); return range.getBoundingClientRect().top; } position-=part.length; }
  },position);
  assert(Math.abs(top-(await page.locator(".reader-dock").boundingBox()).y-(await page.locator(".reader-dock").boundingBox()).height-20) < 60, "Cross-chapter bookmark restores its exact paragraph");
  await page.getByRole("button", { name:"Lưu dấu trang", exact:true }).click();
  await page.getByRole("button", { name:"11 dấu trang", exact:true }).waitFor();
  await page.getByRole("button", { name:"11 dấu trang", exact:true }).click();
  await page.getByRole("button", { name:"Xóa dấu trang Chương 2 · Biển", exact:true }).first().click();
  await page.waitForFunction(() => document.querySelectorAll(".bookmark-jump").length === 10);
  await page.keyboard.press("Escape");
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "Mobile must not overflow");
  await page.screenshot({ path:".reader-deploy/polish-reader-mobile.png", animations:"disabled" });
  return "PASS: covers, continue chapter, undo, multi-file stages/errors, search, compact player, text taps, Aa font, all bookmarks, exact jumps";
}
