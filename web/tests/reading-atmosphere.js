// Standalone CLI check: all API traffic is mocked, including progress writes.
// eslint-disable-next-line @typescript-eslint/no-unused-expressions
async (page) => {
  await page.addInitScript(() => {
    if (window.__ambientProbe) return;
    window.__ambientProbe = { contexts: [] };
    const Base = window.AudioContext;
    window.AudioContext = class extends Base {
      constructor(...args) { super(...args); window.__ambientProbe.contexts.push(this); }
    };
  });
  const assert = (value, message) => { if (!value) throw new Error(message); };
  const chapters = [{ id: "first", title: "Chương 1 · Bên hiên nhà", chapterNumber: 1 }];
  const book = { id: "nature-test", title: "Những ngày gió đi qua", author: "Người kể chuyện", chapterCount: 1, progressPercent: 42, lastReadAt: "2026-10-01T10:00:00Z", chapters };
  let preferences = null;
  await page.route("**/api/**", async (route) => {
    const path = route.request().url().split("/api")[1];
    if (path === "/reader/preferences") {
      if (route.request().method() === "PATCH") preferences = { ...(preferences ?? {}), ...route.request().postDataJSON() };
      return route.fulfill({ json: { preferences, updatedAt: null } });
    }
    let data = {};
    if (path === "/books") data = [book];
    else if (path === "/books/nature-test") data = book;
    else if (path.includes("/chapters/")) data = { ...chapters[0], plainText: "Gió đi qua mái hiên, khẽ lay những chiếc lá. Một câu chuyện bắt đầu trong khoảng lặng của buổi chiều.\n\n".repeat(40) };
    else if (path.includes("/progress/")) data = { chapterId: "first", characterPosition: 0 };
    else if (path.endsWith("/tts/voices")) data = [{ id: "test", provider: "edge", name: "Giọng kể dịu dàng", language: "vi" }];
    else if (path.includes("/tts/chunks/")) data = [{ chunkIndex: 0, text: "Gió đi qua mái hiên", startCharacter: 0, endCharacter: 18 }];
    else if (path.includes("/bookmarks/")) data = [];
    return route.fulfill({ json: data });
  });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("http://localhost:3000/library");
  await page.getByRole("heading", { name: "Một góc yên, một câu chuyện." }).waitFor();
  await page.getByRole("link", { name: "Đọc tiếp →", exact: true }).waitFor();
  await page.screenshot({ animations: "disabled", path: ".reader-deploy/design-library.png" });
  await page.getByRole("link", { name: "Đọc tiếp →", exact: true }).click();
  await page.getByRole("heading", { name: "Mục lục" }).waitFor();
  await page.screenshot({ animations: "disabled", path: ".reader-deploy/design-book.png" });
  await page.getByRole("link", { name: "Đọc tiếp", exact: true }).click();
  await page.getByRole("button", { name: "▶ Đọc", exact: true }).waitFor();
  await page.screenshot({ animations: "disabled", path: ".reader-deploy/design-reader.png" });
  await page.locator(".player-settings summary").click();
  const luminance = (rgb) => rgb.slice(0, 3).map((v) => { v /= 255; return v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; }).reduce((sum, v, i) => sum + v * [.2126, .7152, .0722][i], 0);
  for (const theme of ["Sáng", "Giấy", "Tối", "Rừng", "Biển", "Anh đào", "Hoàng hôn"]) {
    await page.getByRole("button", { name: theme, exact: true }).click();
    await page.waitForFunction((value) => document.documentElement.dataset.theme === value, { Sáng: "light", Giấy: "sepia", Tối: "dark", Rừng: "forest", Biển: "ocean", "Anh đào": "sakura", "Hoàng hôn": "sunset" }[theme]);
    const colors = await page.locator("main").evaluate((el) => {
      const style = getComputedStyle(el);
      return [style.color, style.backgroundColor].map((s) => s.match(/\d+/g).map(Number));
    });
    const levels = colors.map(luminance).sort((a, b) => b - a);
    assert((levels[0] + .05) / (levels[1] + .05) >= 4.5, `${theme}: body contrast must meet AA`);
  }
  await page.locator(".settings-body").evaluate((el) => { el.scrollTop = 0; });
  await page.screenshot({ animations: "disabled", path: ".reader-deploy/design-reader-dark-settings.png" });
  await page.getByRole("button", { name: "Bật âm nền", exact: true }).click();
  await page.waitForFunction(() => window.__ambientProbe.contexts.at(-1)?.state === "running");
  await page.evaluate(() => { Object.defineProperty(document, "hidden", { configurable: true, value: true }); document.dispatchEvent(new Event("visibilitychange")); });
  await page.waitForFunction(() => window.__ambientProbe.contexts.at(-1)?.state === "suspended");
  await page.evaluate(() => { delete document.hidden; document.dispatchEvent(new Event("visibilitychange")); });
  await page.waitForFunction(() => window.__ambientProbe.contexts.at(-1)?.state === "running");
  await page.getByRole("button", { name: "Tắt âm nền", exact: true }).click();
  await page.getByRole("button", { name: "Giấy", exact: true }).click();
  await page.waitForFunction(() => document.documentElement.dataset.theme === "sepia");
  await page.setViewportSize({ width: 390, height: 844 });
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), "Mobile must not overflow horizontally");
  await page.locator(".settings-body").evaluate((el) => { el.scrollTop = 0; });
  await page.getByRole("button", { name: "▶ Đọc", exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ animations: "disabled", path: ".reader-deploy/design-mobile-settings.png" });
  await page.locator(".player-settings summary").click();
  await page.evaluate(() => window.scrollTo(0, 900));
  const rect = await page.locator(".reader-dock").boundingBox();
  assert(rect.y >= 63 && rect.y < 66, "Player must stay below the 64px header");
  await page.screenshot({ animations: "disabled", path: ".reader-deploy/design-mobile-reader.png" });
  await page.locator(".falling-leaf").waitFor({ timeout: 27000 });
  assert(await page.locator(".falling-leaf").count() <= 1, "Only one mobile leaf");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.waitForFunction(() => !document.querySelector(".falling-leaf"));
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.locator(".player-settings summary").click();
  await page.getByLabel("Lá rơi nhẹ").uncheck();
  assert(await page.locator(".falling-leaf").count() === 0, "Leaf toggle must stop decoration");
  await page.getByRole("button", { name: "Anh đào", exact: true }).click();
  await page.reload();
  await page.waitForFunction(() => document.documentElement.dataset.theme === "sakura");
  await page.getByRole("button", { name: "▶ Đọc", exact: true }).waitFor();
  await page.locator(".player-settings summary").click();
  assert(!(await page.getByLabel("Lá rơi nhẹ").isChecked()), "Leaf preference must persist");
  await page.getByLabel("Lá rơi nhẹ").check();
  return "PASS: library/detail/reader, theme contrast, mobile layout, sticky player, visibility audio, leaves, reduced motion, persistence";
}
