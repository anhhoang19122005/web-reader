"use client";

/* Full navigations intentionally trigger the service worker offline shell. */
/* eslint-disable @next/next/no-html-link-for-pages */

import { useEffect, useRef, useState } from "react";
import { type Book, type Chapter } from "../lib/api";
import { useReadingPreferences } from "../lib/reading-preferences";
import { scrollToCharacter, visibleCharacter } from "../lib/reader-position";
import { offlineProgressKey } from "./PwaSupport";

export function OfflineReader() {
  const [items, setItems] = useState<{ bookId: string; bookTitle: string; chapter: Chapter }[]>([]);
  const [active, setActive] = useState("");
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const text = useRef<HTMLDivElement | null>(null);
  const prefs = useReadingPreferences();
  const item = items.find((entry) => entry.chapter.id === active);
  useEffect(() => { void (async () => {
    try {
      if (!("caches" in window)) throw new Error("Trình duyệt chưa hỗ trợ lưu offline.");
      const cache = await caches.open("gac-sach-content-v1");
      const requests = await cache.keys();
      const books = new Map<string, Book>();
      const chapters: { bookId: string; bookTitle: string; chapter: Chapter }[] = [];
      for (const request of requests) {
        const path = new URL(request.url).pathname;
        if (/^\/api\/books\/[^/]+$/.test(path)) books.set(path.split("/")[3], await (await cache.match(request))!.json());
      }
      for (const request of requests) {
        const match = new URL(request.url).pathname.match(/^\/api\/books\/([^/]+)\/chapters\/[^/]+$/);
        if (match) chapters.push({ bookId: match[1], bookTitle: books.get(match[1])?.title ?? "Sách đã lưu", chapter: await (await cache.match(request))!.json() });
      }
      chapters.sort((a, b) => a.bookTitle.localeCompare(b.bookTitle) || a.chapter.chapterNumber-b.chapter.chapterNumber);
      setItems(chapters);
      const requested = location.pathname.match(/\/reader\/[^/]+\/([^/]+)/)?.[1];
      if (requested && chapters.some((entry) => entry.chapter.id === requested)) setActive(requested);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Không mở được bộ nhớ offline."); }
    finally { setReady(true); }
  })(); }, []);
  useEffect(() => {
    if (!item || !text.current) return;
    const queued = JSON.parse(localStorage.getItem(offlineProgressKey) || "{}")[item.bookId];
    const frame = requestAnimationFrame(() => { if (queued?.chapterId === item.chapter.id && text.current) scrollToCharacter(text.current, queued.characterPosition, 84); });
    let timer: ReturnType<typeof setTimeout>;
    let manual = false;
    const mark = () => { manual = true; };
    const scrollKey = (event: KeyboardEvent) => { if (["PageDown", "PageUp", "Home", "End", "ArrowDown", "ArrowUp", " "].includes(event.key) && !(event.target instanceof Element && event.target.closest("button,input,select,a"))) mark(); };
    const scroll = () => { if (!manual) return; clearTimeout(timer); timer = setTimeout(() => {
      if (!text.current) return;
      const position = visibleCharacter(text.current, 84);
      const pending = JSON.parse(localStorage.getItem(offlineProgressKey) || "{}");
      const old = pending[item.bookId];
      if (!old || old.chapterNumber < item.chapter.chapterNumber || (old.chapterId === item.chapter.id && old.characterPosition < position)) {
        pending[item.bookId] = { chapterId: item.chapter.id, chapterNumber: item.chapter.chapterNumber, characterPosition: position };
        localStorage.setItem(offlineProgressKey, JSON.stringify(pending));
      }
    }, 500); };
    window.addEventListener("wheel", mark, { passive: true }); window.addEventListener("touchmove", mark, { passive: true }); window.addEventListener("scroll", scroll, { passive: true }); window.addEventListener("keydown", scrollKey);
    return () => { cancelAnimationFrame(frame); clearTimeout(timer); window.removeEventListener("wheel", mark); window.removeEventListener("touchmove", mark); window.removeEventListener("scroll", scroll); window.removeEventListener("keydown", scrollKey); };
  }, [item]);
  return <main className="app-surface min-h-screen"><header className="site-header"><a className="wordmark" href="/library">Gác Sách</a><button onClick={() => { setActive(""); window.scrollTo(0,0); }}>Sách offline</button></header><section className="reader-column px-6 py-8" style={{ maxWidth: `${prefs.columnWidth}ch` }}><h1 className="book-title">{item?.bookTitle ?? "Chương đã lưu trên thiết bị"}</h1><p className="subtle mt-3">Lưu tự động các chương đã mở · tối đa 40 mục dữ liệu. Tiến độ đọc offline sẽ gửi khi có mạng. Giọng đọc cần kết nối API.</p>{!ready && <p role="status">Đang mở bộ nhớ offline…</p>}{error && <p role="alert">{error}</p>}{item ? <><h2 className="book-title mt-8">{item.chapter.title}</h2><div ref={text} className="reader-text whitespace-pre-line mt-8" style={{ fontSize: prefs.fontSize, lineHeight: prefs.lineHeight, fontFamily: prefs.font === "serif" ? "var(--font-reader-serif), Georgia, serif" : "Arial, Helvetica, sans-serif" }}><span data-start="0" data-end={item.chapter.plainText.length}>{item.chapter.plainText}</span></div><p className="mt-8"><a href={`/reader/${item.bookId}/${item.chapter.id}`}>Mở Reader khi có kết nối</a></p></> : <><ol className="chapter-list">{items.map((entry) => <li key={entry.chapter.id}><button onClick={() => { setActive(entry.chapter.id); window.scrollTo(0,0); }}>{entry.bookTitle} · {entry.chapter.title}</button></li>)}</ol>{ready && !items.length && <p className="mt-8">Chưa có chương offline. Mở một chương khi có mạng để lưu.</p>}<button className="mt-8" onClick={async () => { await caches.delete("gac-sach-content-v1"); setItems([]); }}>Xóa bản lưu offline</button></>}</section></main>;
}
