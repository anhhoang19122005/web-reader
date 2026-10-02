"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { createBookmark, deleteBookmark, getBook, getBookmarks, getChapter, getProgress, saveProgress, TtsChunk, type ReadingProgress } from "../lib/api";
import { Icon } from "./Icon";
import { AtmosphereControls } from "./ReadingAtmosphere";
import { TtsPlayer } from "./TtsPlayer";
import { readingThemes, useReadingPreferences, useReaderSession } from "../lib/reading-preferences";
import { characterRange, scrollToCharacter, visibleCharacter } from "../lib/reader-position";
import { useTtsSession } from "../lib/tts-session";

function highlightedText(text: string, chunks: TtsChunk[], activeChunk: number | null): ReactNode[] {
  const nodes: ReactNode[] = [];
  let cursor = 0;
  chunks.forEach((chunk) => {
    const start = Math.max(cursor, chunk.startCharacter);
    const end = Math.min(text.length, chunk.endCharacter);
    if (start > cursor) nodes.push(<span key={`text-${cursor}`}>{text.slice(cursor, start)}</span>);
    if (end > start) {
      const isActive = activeChunk === chunk.chunkIndex;
      nodes.push(<mark className={isActive ? "reading-highlight scroll-mt-28" : "rounded bg-transparent text-inherit"} key={`chunk-${chunk.chunkIndex}`}>{text.slice(start, end)}</mark>);
    }
    cursor = Math.max(cursor, end);
  });
  if (cursor < text.length) nodes.push(<span key={`text-${cursor}`}>{text.slice(cursor)}</span>);
  return nodes;
}

function chapterParagraphs(text: string, chunk: TtsChunk | null) {
  let offset = 0;
  return (text.match(/[^\n]*\n|[^\n]+$/g) ?? []).map((part) => {
    const start = offset; offset += part.length;
    const local = chunk ? [{ ...chunk, startCharacter: chunk.startCharacter - start, endCharacter: chunk.endCharacter - start }] : [];
    return <span key={start} data-start={start} data-end={offset}>{highlightedText(part, local, chunk?.chunkIndex ?? null)}</span>;
  });
}

export function ReaderClient({ bookId, chapterId }: { bookId: string; chapterId: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const bookmarkTarget = searchParams.get("position");
  const settingsRef = useRef<HTMLDivElement | null>(null);
  const [drawerView, setDrawerView] = useState<"chapters" | "bookmarks">("chapters");
  const reading = useTtsSession((state) => state.running);
  const { focus } = useReaderSession();
  const preferences = useReadingPreferences();
  const { theme, font, fontSize, lineHeight, columnWidth, ready, syncStatus } = preferences;
  const queryClient = useQueryClient();
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [bookmarkResume, setBookmarkResume] = useState<{ chapterId: string; position: number } | null>(null);
  const [ttsChunk, setTtsChunk] = useState<TtsChunk | null>(null);
  const [viewPosition, setViewPosition] = useState(0);
  const [followReading, setFollowReading] = useState(true);
  const [showHint, setShowHint] = useState(false);
  const [chapterSearch, setChapterSearch] = useState("");
  const textContainerRef = useRef<HTMLDivElement | null>(null);
  const playerContainerRef = useRef<HTMLDivElement | null>(null);
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const tocTrigger = useRef<HTMLElement | null>(null);
  const followReadingRef = useRef(true);
  const autoUntil = useRef(0);
  const manualUntil = useRef(0);
  const restored = useRef("");
  const prefetched = useRef("");
  const anchor = useRef({ position: 0, gap: 0, atTop: true });
  const previousFocus = useRef(focus);
  const bookQuery = useQuery({ queryKey: ["book", bookId], queryFn: () => getBook(bookId) });
  const chapterQuery = useQuery({ queryKey: ["chapter", bookId, chapterId], queryFn: () => getChapter(bookId, chapterId), staleTime: Infinity, gcTime: 30 * 60_000 });
  const progressQuery = useQuery({ queryKey: ["progress", bookId], queryFn: () => getProgress(bookId) });
  const bookmarksQuery = useQuery({ queryKey: ["bookmarks", bookId], queryFn: () => getBookmarks(bookId) });
  const { mutate: persistProgress } = useMutation({
    mutationFn: ({ nextChapterId, characterPosition }: { nextChapterId: string; characterPosition: number }) => saveProgress(bookId, nextChapterId, characterPosition),
    onSuccess: (progress) => queryClient.setQueryData(["progress", bookId], (previous: ReadingProgress | undefined) => {
      if (!previous?.chapterId) return progress;
      const order = (id: string | null) => bookQuery.data?.chapters.find((chapter) => chapter.id === id)?.chapterNumber ?? 0;
      return order(previous.chapterId) > order(progress.chapterId) || (previous.chapterId === progress.chapterId && previous.characterPosition >= progress.characterPosition) ? previous : progress;
    }),
  });
  const chapterText = chapterQuery.data?.plainText;
  const chapters = bookQuery.data?.chapters ?? [];
  const chapterIndex = chapters.findIndex((chapter) => chapter.id === chapterId);
  const previousChapter = chapters[chapterIndex - 1];
  const nextChapter = chapters[chapterIndex + 1];

  const inset = useCallback(() => useReaderSession.getState().focus ? 60 : 84 + (playerContainerRef.current?.offsetHeight ?? 0), []);
  const suppressSave = useCallback(() => { clearTimeout(saveTimer.current); manualUntil.current = 0; autoUntil.current = Date.now() + 800; }, []);
  const rememberView = useCallback(() => {
    const container = textContainerRef.current;
    if (!container) return;
    const position = visibleCharacter(container, inset());
    const rect = characterRange(container, position)?.getBoundingClientRect();
    anchor.current = { position, gap: rect ? Math.min(0, rect.top - inset()) : 0, atTop: window.scrollY <= 1 };
    if (!useTtsSession.getState().running) setViewPosition(position);
  }, [inset]);
  const restoreView = useCallback(() => {
    if (!textContainerRef.current) return;
    suppressSave();
    if (anchor.current.atTop) window.scrollTo({ top: 0, behavior: "instant" });
    else scrollToCharacter(textContainerRef.current, anchor.current.position, inset() + anchor.current.gap);
    if (!useTtsSession.getState().running) setViewPosition(anchor.current.position);
  }, [inset, suppressSave]);

  const handleTtsProgress = useCallback((characterPosition: number) => {
    setViewPosition(characterPosition);
    persistProgress({ nextChapterId: chapterId, characterPosition });
  }, [chapterId, persistProgress]);
  const bookmarkMutation = useMutation({ mutationFn: (position: number) => createBookmark(bookId, { chapterId, characterPosition: position }), onSuccess: () => queryClient.invalidateQueries({ queryKey: ["bookmarks", bookId] }) });
  const removeBookmark = useMutation({ mutationFn: (bookmarkId: string) => deleteBookmark(bookId, bookmarkId), onSuccess: () => queryClient.invalidateQueries({ queryKey: ["bookmarks", bookId] }) });

  const selectChapter = useCallback((nextChapterId: string, auto = false) => {
    suppressSave();
    dialogRef.current?.close();
    useTtsSession.setState({ running: auto, autoplayChapterId: auto ? nextChapterId : "" });
    setTtsChunk(null);
    persistProgress({ nextChapterId, characterPosition: 0 });
    router.push(`/reader/${bookId}/${nextChapterId}`);
  }, [bookId, persistProgress, router, suppressSave]);

  useEffect(() => {
    if (chapterText === undefined || !ready || progressQuery.isLoading || restored.current === chapterId) return;
    const frame = requestAnimationFrame(() => {
      restored.current = chapterId;
      const requested = bookmarkTarget !== null ? Number(bookmarkTarget) : NaN;
      const position = Number.isInteger(requested) && requested >= 0 ? Math.min(chapterText.length, requested) : progressQuery.data?.chapterId === chapterId ? Math.min(chapterText.length, progressQuery.data.characterPosition) : 0;
      anchor.current = { position, gap: 0, atTop: position === 0 };
      if (anchor.current.position) restoreView();
      else { suppressSave(); window.scrollTo({ top: 0, behavior: "instant" }); rememberView(); }
    });
    return () => cancelAnimationFrame(frame);
  }, [chapterId, chapterText, ready, progressQuery.isLoading, progressQuery.data, bookmarkTarget, rememberView, restoreView, suppressSave]);

  useEffect(() => {
    if (!chapterText) return;
    let frame = 0;
    const markManual = (event: Event) => {
      const target = event.target;
      if (target instanceof Element && target.closest("input,select,button,a,summary,audio,dialog,.settings-body")) return;
      autoUntil.current = 0;
      manualUntil.current = Date.now() + 2500;
      if (followReadingRef.current) { followReadingRef.current = false; setFollowReading(false); }
    };
    const scrollKey = (event: KeyboardEvent) => { if (["PageDown", "PageUp", "Home", "End", "ArrowDown", "ArrowUp", " "].includes(event.key)) markManual(event); };
    const handleScroll = () => {
      if (Date.now() < autoUntil.current) return;
      cancelAnimationFrame(frame); frame = requestAnimationFrame(rememberView);
      if (Date.now() < autoUntil.current || Date.now() > manualUntil.current || useTtsSession.getState().running || restored.current !== chapterId) return;
      clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => {
        if (useTtsSession.getState().running || Date.now() < autoUntil.current) return;
        rememberView();
        persistProgress({ nextChapterId: chapterId, characterPosition: anchor.current.position });
      }, 1500);
    };
    window.addEventListener("scroll", handleScroll, { passive: true });
    window.addEventListener("wheel", markManual, { passive: true });
    window.addEventListener("touchmove", markManual, { passive: true });
    window.addEventListener("pointerdown", markManual, { passive: true });
    window.addEventListener("keydown", scrollKey);
    return () => { clearTimeout(saveTimer.current); cancelAnimationFrame(frame); window.removeEventListener("scroll", handleScroll); window.removeEventListener("wheel", markManual); window.removeEventListener("touchmove", markManual); window.removeEventListener("pointerdown", markManual); window.removeEventListener("keydown", scrollKey); };
  }, [chapterId, chapterText, persistProgress, rememberView]);

  useEffect(() => {
    if (!chapterText) return;
    let frame = 0;
    const unsubscribe = useReadingPreferences.subscribe((state, previous) => {
      if (["font", "fontSize", "lineHeight", "columnWidth"].some((key) => state[key as keyof typeof state] !== previous[key as keyof typeof previous])) {
        if (Date.now() > autoUntil.current) rememberView();
        suppressSave(); cancelAnimationFrame(frame); frame = requestAnimationFrame(restoreView);
      }
    });
    let first = true;
    const observer = new ResizeObserver(() => {
      if (first) { first = false; return; }
      suppressSave(); cancelAnimationFrame(frame); frame = requestAnimationFrame(restoreView);
    });
    if (textContainerRef.current) observer.observe(textContainerRef.current);
    if (playerContainerRef.current) observer.observe(playerContainerRef.current);
    return () => { unsubscribe(); observer.disconnect(); cancelAnimationFrame(frame); };
  }, [chapterText, rememberView, restoreView, suppressSave]);

  useEffect(() => {
    if (previousFocus.current === focus) return;
    previousFocus.current = focus;
    const frame = requestAnimationFrame(restoreView);
    return () => cancelAnimationFrame(frame);
  }, [focus, restoreView]);
  useEffect(() => () => { useReaderSession.setState({ focus: false }); }, []);

  useEffect(() => {
    if (!ttsChunk || !followReadingRef.current) return;
    const frame = requestAnimationFrame(() => {
      const container = textContainerRef.current;
      const node = container?.querySelector(".reading-highlight");
      if (!(node instanceof HTMLElement)) return;
      const rect = node.getBoundingClientRect();
      if (rect.top < inset() || rect.bottom > window.innerHeight - 80) {
        suppressSave();
        window.scrollTo({ top: window.scrollY + rect.top - inset(), behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" });
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [ttsChunk, inset, suppressSave]);

  useEffect(() => {
    if (!chapterText || !nextChapter || (viewPosition / chapterText.length < .7 && (ttsChunk?.endCharacter ?? 0) < chapterText.length)) return;
    if (prefetched.current === nextChapter.id) return;
    prefetched.current = nextChapter.id;
    void queryClient.prefetchQuery({ queryKey: ["chapter", bookId, nextChapter.id], queryFn: () => getChapter(bookId, nextChapter.id), staleTime: Infinity, gcTime: 30 * 60_000 });
  }, [bookId, chapterText, nextChapter, queryClient, ttsChunk, viewPosition]);

  function openToc(trigger?: HTMLElement) {
    setDrawerView("chapters");
    tocTrigger.current = trigger ?? document.activeElement as HTMLElement;
    dialogRef.current?.showModal();
  }
  useEffect(() => { const timer = setTimeout(() => setShowHint(!localStorage.getItem("gac-sach-focus-hint")), 0); return () => clearTimeout(timer); }, []);
  function toggleFocus() { localStorage.setItem("gac-sach-focus-hint", "seen"); setShowHint(false); rememberView(); suppressSave(); useReaderSession.setState({ focus: !useReaderSession.getState().focus }); }
  function jumpBookmark(targetChapter: string, position: number) {
    dialogRef.current?.close(); stopReading(); suppressSave();
    setBookmarkResume({ chapterId: targetChapter, position });
    if (targetChapter === chapterId) {
      followReadingRef.current = false; setFollowReading(false); setTtsChunk(null);
      anchor.current = { position: Math.min(chapterText?.length ?? 0, position), gap: 0, atTop: position === 0 };
      restoreView();
    } else {
      restored.current = "";
      router.push(`/reader/${bookId}/${targetChapter}?position=${position}`);
    }
  }
  useEffect(() => { if (!chapterQuery.data || !bookQuery.data) return; const timer = setTimeout(() => { document.title = `${chapterQuery.data.title} · ${bookQuery.data.title} · Gác Sách`; }, 0); return () => clearTimeout(timer); }, [chapterQuery.data, bookQuery.data]);
  function stopReading() { useTtsSession.setState({ running: false, speechPlaying: false, autoplayChapterId: "" }); }
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.altKey || event.metaKey || event.shiftKey || event.defaultPrevented) return;
      if (dialogRef.current?.open) return;
      if (event.target instanceof Element && event.target.closest("input,textarea,select,button,a,summary,audio,[contenteditable]")) return;
      const key = event.key.toLowerCase();
      if (!["f", "t", "d", "escape", "arrowleft", "arrowright"].includes(key)) return;
      event.preventDefault();
      if (key === "f") toggleFocus();
      else if (key === "escape") { if (useReaderSession.getState().focus) toggleFocus(); }
      else if (key === "t") openToc();
      else if (key === "d") {
        const index = readingThemes.findIndex((option) => option.id === useReadingPreferences.getState().theme);
        useReadingPreferences.setState({ theme: readingThemes[(index + 1) % readingThemes.length].id });
      } else if (key === "arrowleft" && previousChapter) selectChapter(previousChapter.id);
      else if (key === "arrowright" && nextChapter) selectChapter(nextChapter.id);
    };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  });

  function handleTtsChunk(chunk: TtsChunk | null, info?: { auto: boolean }) {
    if (chunk && !info?.auto) { followReadingRef.current = true; setFollowReading(true); }
    setTtsChunk(chunk);
    if (chunk) { setViewPosition(chunk.startCharacter); persistProgress({ nextChapterId: chapterId, characterPosition: chunk.startCharacter }); }
  }
  const percent = chapterText?.length ? Math.min(100, Math.round(viewPosition / chapterText.length * 100)) : 0;
  const remainingMinutes = Math.ceil((chapterText?.slice(viewPosition).trim().split(/\s+/).filter(Boolean).length ?? 0) / 200);
  const settings = <div className="reader-settings">
    <span className="text-muted">Giao diện</span><div className="theme-options" role="group" aria-label="Theme giao diện">{readingThemes.map((option) => <button className="theme-option" aria-pressed={theme === option.id} key={option.id} onClick={() => useReadingPreferences.setState({ theme: option.id })}><span className="theme-swatch" aria-hidden="true" style={{ backgroundColor: option.color }} />{option.name}</button>)}</div>
    <label>Font chữ <select aria-label="Font chữ" value={font} onChange={(e) => useReadingPreferences.setState({ font: e.target.value as "sans" | "serif" })}><option value="sans">Sans · Arial</option><option value="serif">Serif · Source Serif 4</option></select></label>
    <label>Cỡ chữ <input aria-label="Cỡ chữ" type="range" min="16" max="28" step="1" value={fontSize} onChange={(e) => useReadingPreferences.setState({ fontSize: Number(e.target.value) })} /> {fontSize}px</label>
    <label>Giãn dòng <input aria-label="Giãn dòng" type="range" min="1.5" max="2.2" step="0.1" value={lineHeight} onChange={(e) => useReadingPreferences.setState({ lineHeight: Number(e.target.value) })} /> {lineHeight}</label>
    <label>Độ rộng dòng <select aria-label="Độ rộng dòng" value={columnWidth} onChange={(e) => useReadingPreferences.setState({ columnWidth: Number(e.target.value) as 60 | 68 | 75 })}>{[60,68,75].map((width) => <option key={width} value={width}>{width} ký tự</option>)}</select></label>
    <p className="subtle" role="status">{syncStatus === "saved" ? "Đã đồng bộ tùy chỉnh" : syncStatus === "offline" ? "Đang dùng cấu hình trên máy · sẽ đồng bộ khi có kết nối" : "Đang đồng bộ tùy chỉnh…"}</p>
  </div>;

  if (bookQuery.isLoading || chapterQuery.isLoading) return <main className="reading-surface min-h-screen p-8" aria-busy="true"><p className="subtle">Đang mở chương…</p><div className="reader-skeleton mx-auto max-w-2xl" aria-hidden="true">{[1,2,3,4,5].map((line) => <div key={line} />)}</div>{reading && <button className="primary-button" onClick={stopReading}>■ Dừng</button>}</main>;
  if (bookQuery.isError || chapterQuery.isError || !bookQuery.data || !chapterQuery.data) return <main className="reading-surface grid min-h-screen place-items-center"><div><Link href="/library">Không tìm thấy chương. Về thư viện</Link>{reading && <button className="primary-button ml-3" onClick={stopReading}>■ Dừng</button>}</div></main>;
  const bookmarkPosition = viewPosition;
  const bookPercent = chapters.length ? Math.round((Math.max(0, chapterIndex) + percent / 100) / chapters.length * 100) : 0;
  const fold = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/g,"d").replace(/Đ/g,"D").toLowerCase();
  return <main className={`min-h-screen reading-surface reader-page ${focus ? "reader-focus" : ""}`}>
    <header className="site-header sticky top-0 z-20 reader-header"><Link className="wordmark" href={`/library/${bookId}`}>Gác Sách</Link><div className="flex items-center gap-3"><button onClick={(e) => openToc(e.currentTarget)}>Mục lục</button><button aria-label="Tùy chỉnh chữ và không gian" popoverTarget="reader-preferences">Aa</button><button onClick={toggleFocus}>Tập trung</button></div></header>
    <div className="chapter-progress" role="progressbar" aria-label="Tiến độ chương" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}><span style={{ width: `${percent}%` }} /></div>
    <article className="reader-column px-6 py-8 md:px-8" style={{ maxWidth: `calc(${columnWidth}ch + 4rem)`, fontSize, fontFamily: font === "serif" ? "var(--font-reader-serif), Georgia, serif" : "Arial, Helvetica, sans-serif" }}>
      <div className="reader-title"><p className="text-sm text-muted">{bookQuery.data.author}</p><h1 className="mt-2 text-3xl font-semibold md:text-4xl">{chapterQuery.data.title}</h1></div>
      <div ref={playerContainerRef} className="sticky top-16 z-10 mt-5 rounded-xl reader-dock reading-surface"><TtsPlayer onLayoutChange={() => { if (Date.now() > autoUntil.current) rememberView(); suppressSave(); }} key={`${chapterId}-${bookmarkResume?.chapterId === chapterId ? bookmarkResume.position : "default"}`} chapterId={chapterId} initialPosition={progressQuery.isLoading ? undefined : bookmarkResume?.chapterId === chapterId ? bookmarkResume.position : bookmarkTarget !== null && Number.isInteger(Number(bookmarkTarget)) && Number(bookmarkTarget) >= 0 ? Number(bookmarkTarget) : progressQuery.data?.chapterId === chapterId ? progressQuery.data.characterPosition : 0} onProgress={handleTtsProgress} onChunkChange={handleTtsChunk} onComplete={() => {
        if (!useTtsSession.getState().running) return;
        if (nextChapter) selectChapter(nextChapter.id, true);
        else stopReading();
      }} /></div>
      <div className="reader-tools mt-4 flex flex-wrap items-center gap-3 text-sm"><button disabled={bookmarkMutation.isPending} onClick={() => bookmarkMutation.mutate(bookmarkPosition)}><Icon name="bookmark" /> Lưu dấu trang</button><button aria-pressed={followReading} onClick={() => { followReadingRef.current = !followReading; setFollowReading(!followReading); }}><Icon name="eye" />{followReading ? "Bám theo đoạn đọc" : "Đã dừng bám theo"}</button><button onClick={(e) => { openToc(e.currentTarget); setDrawerView("bookmarks"); }}>{bookmarksQuery.data?.length ?? 0} dấu trang</button></div>
      {bookmarkMutation.isError && <p className="error-message" role="alert">Không lưu được dấu trang.</p>}
      {showHint && <p className="reader-tools subtle mt-3">Dùng nút Tập trung hoặc phím F để ẩn điều khiển. Chạm vào chữ vẫn chọn văn bản bình thường. <button aria-label="Ẩn gợi ý tập trung" onClick={() => { localStorage.setItem("gac-sach-focus-hint", "seen"); setShowHint(false); }}>Đã hiểu</button></p>}
      <p className="reader-estimate subtle mt-4">{percent}% chương · {bookPercent}% cả sách · Còn khoảng {remainingMinutes} phút đọc</p>
      <div ref={textContainerRef} className="reader-text mt-8 whitespace-pre-line" style={{ fontFamily: "inherit", lineHeight }}>{chapterParagraphs(chapterQuery.data.plainText, ttsChunk)}</div>
      <footer className="reader-tools mt-14 flex justify-between border-t border-current/10 pb-40 pt-5 text-sm"><button disabled={!previousChapter} onClick={() => previousChapter && selectChapter(previousChapter.id)}>← Chương trước</button><button disabled={!nextChapter} onClick={() => nextChapter && selectChapter(nextChapter.id)}>Chương sau →</button></footer>
    </article>
    <nav className="mobile-reader-bar" aria-label="Điều khiển đọc"><button onClick={(e) => openToc(e.currentTarget)}>Mục lục</button><button aria-label="Tùy chỉnh chữ và không gian" popoverTarget="reader-preferences">Aa</button><button onClick={toggleFocus}>{focus ? "Thoát tập trung" : "Tập trung"}</button>{reading && <button onClick={stopReading}>Dừng đọc</button>}</nav>
    {focus && <div className="focus-controls"><button onClick={toggleFocus}>Thoát tập trung</button>{reading && <button onClick={stopReading}>Dừng đọc</button>}</div>}
    <div id="reader-preferences" ref={settingsRef} popover="auto" className="reader-settings-popover" aria-label="Tùy chỉnh chữ và không gian"><div className="drawer-header"><h2>Chữ & không gian</h2><button autoFocus aria-label="Đóng tùy chỉnh" onClick={() => settingsRef.current?.hidePopover()}><Icon name="close" /></button></div>{settings}<AtmosphereControls /></div>
    <dialog ref={dialogRef} className="chapter-drawer" aria-labelledby="toc-title" onClose={() => tocTrigger.current?.focus()}><div className="drawer-header"><h2 id="toc-title">Mục lục & dấu trang</h2><button aria-label="Đóng mục lục" onClick={() => dialogRef.current?.close()}>Đóng</button></div><p className="subtle">{bookQuery.data.title}</p><div className="drawer-switch" role="group" aria-label="Nội dung điều hướng"><button aria-pressed={drawerView === "chapters"} onClick={() => setDrawerView("chapters")}>Chương</button><button aria-pressed={drawerView === "bookmarks"} onClick={() => setDrawerView("bookmarks")}>Dấu trang ({bookmarksQuery.data?.length ?? 0})</button></div>{drawerView === "chapters" ? <><label className="block mt-5">Tìm chương<input className="chapter-search" aria-label="Tìm chương" value={chapterSearch} onChange={(e) => setChapterSearch(e.target.value)} /></label><ol className="chapter-list">{chapters.filter((chapter) => fold(chapter.title).includes(fold(chapterSearch))).map((chapter) => <li key={chapter.id}><button aria-current={chapter.id === chapterId ? "page" : undefined} onClick={() => selectChapter(chapter.id)}><span>{chapter.chapterNumber}. {chapter.title}</span><span className="subtle">{chapter.id === progressQuery.data?.chapterId ? "Đọc tới đây" : chapter.id === chapterId ? "Đang mở" : ""}</span></button></li>)}</ol></> : <div className="bookmark-list">
      {bookmarksQuery.isLoading && <p role="status">Đang tải dấu trang…</p>}
      {bookmarksQuery.isError && <p className="error-message" role="alert">Không tải được dấu trang.</p>}
      {bookmarksQuery.data?.length === 0 && <p className="subtle">Lưu dấu trang để trở lại đoạn yêu thích.</p>}
      {bookmarksQuery.data?.map((bookmark) => <div key={bookmark.id}><button className="bookmark-jump" onClick={() => jumpBookmark(bookmark.chapterId, bookmark.characterPosition)}><strong>{bookmark.chapterTitle || chapters.find((chapter) => chapter.id === bookmark.chapterId)?.title || "Chương đã lưu"}</strong><span>{bookmark.excerpt || (bookmark.chapterId === chapterId ? chapterText?.slice(Math.max(0, bookmark.characterPosition-20), bookmark.characterPosition+40).trim() : "Mở đoạn đã đánh dấu")}</span>{bookmark.note && <small>{bookmark.note}</small>}</button><button aria-label={`Xóa dấu trang ${bookmark.chapterTitle || bookmark.id}`} disabled={removeBookmark.isPending} onClick={() => removeBookmark.mutate(bookmark.id)}>Xóa</button></div>)}
      {removeBookmark.isError && <p className="error-message" role="alert">Không xóa được dấu trang.</p>}
    </div>}</dialog>
  </main>;
}
