"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { createBookmark, deleteBookmark, getBook, getBookmarks, getChapter, getProgress, saveProgress, TtsChunk } from "../lib/api";
import { TtsPlayer } from "./TtsPlayer";
import { useReadingPreferences } from "../lib/reading-preferences";
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

export function ReaderClient({ bookId, chapterId }: { bookId: string; chapterId: string }) {
  const router = useRouter();
  const reading = useTtsSession((state) => state.running);
  const queryClient = useQueryClient();
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const { theme, textStyle } = useReadingPreferences();
  const setTheme = (theme: "light" | "sepia" | "dark") => useReadingPreferences.setState({ theme });
  const setTextStyle = (textStyle: "compact" | "comfortable" | "large") => useReadingPreferences.setState({ textStyle });
  const [ttsChunk, setTtsChunk] = useState<TtsChunk | null>(null);
  const [followReading, setFollowReading] = useState(true);
  const textContainerRef = useRef<HTMLDivElement | null>(null);
  const playerContainerRef = useRef<HTMLDivElement | null>(null);
  const followReadingRef = useRef(true);
  const lastAutoScroll = useRef(0);
  const bookQuery = useQuery({ queryKey: ["book", bookId], queryFn: () => getBook(bookId) });
  const chapterQuery = useQuery({ queryKey: ["chapter", bookId, chapterId], queryFn: () => getChapter(bookId, chapterId) });
  const progressQuery = useQuery({ queryKey: ["progress", bookId], queryFn: () => getProgress(bookId) });
  const bookmarksQuery = useQuery({ queryKey: ["bookmarks", bookId], queryFn: () => getBookmarks(bookId) });
  const { mutate: persistProgress } = useMutation({ mutationFn: ({ nextChapterId, characterPosition }: { nextChapterId: string; characterPosition: number }) => saveProgress(bookId, nextChapterId, characterPosition) });
  const handleTtsProgress = useCallback((characterPosition: number) => {
    persistProgress({ nextChapterId: chapterId, characterPosition });
  }, [chapterId, persistProgress]);
  const bookmarkMutation = useMutation({ mutationFn: (position: number) => createBookmark(bookId, { chapterId, characterPosition: position }), onSuccess: () => queryClient.invalidateQueries({ queryKey: ["bookmarks", bookId] }) });
  const removeBookmark = useMutation({ mutationFn: (bookmarkId: string) => deleteBookmark(bookId, bookmarkId), onSuccess: () => queryClient.invalidateQueries({ queryKey: ["bookmarks", bookId] }) });
  const chapterText = chapterQuery.data?.plainText;

  function selectChapter(nextChapterId: string, auto = false) {
    useTtsSession.setState({ running: auto, autoplayChapterId: auto ? nextChapterId : "" });
    setTtsChunk(null);
    persistProgress({ nextChapterId, characterPosition: 0 });
    router.push(`/reader/${bookId}/${nextChapterId}`);
  }

  useEffect(() => {
    if (!chapterText || progressQuery.data?.chapterId !== chapterId || progressQuery.data.characterPosition === 0) return;
    const maxScroll = document.documentElement.scrollHeight - window.innerHeight;
    window.scrollTo({ top: maxScroll * (progressQuery.data.characterPosition / chapterText.length) });
  }, [chapterId, chapterText, progressQuery.data]);

  useEffect(() => {
    if (!chapterText) return;
    const handleScroll = () => {
      if (useTtsSession.getState().running) return;
      clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => {
        if (useTtsSession.getState().running) return;
        const maxScroll = document.documentElement.scrollHeight - window.innerHeight;
        const ratio = maxScroll > 0 ? window.scrollY / maxScroll : 0;
        persistProgress({ nextChapterId: chapterId, characterPosition: Math.round(ratio * chapterText.length) });
      }, 1500);
    };
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => { window.removeEventListener("scroll", handleScroll); clearTimeout(saveTimer.current); };
  }, [chapterId, chapterText, persistProgress]);

  useEffect(() => {
    followReadingRef.current = followReading;
  }, [followReading]);

  // Cuộn bám theo đoạn đang đọc: chỉ cuộn khi đoạn khuất khỏi màn hình.
  useEffect(() => {
    if (!followReading || ttsChunk == null) return;
    const frame = requestAnimationFrame(() => {
      const node = textContainerRef.current?.querySelector("mark");
      if (!(node instanceof HTMLElement) || !followReadingRef.current) return;
      const rect = node.getBoundingClientRect();
      const topInset = 64 + (playerContainerRef.current?.offsetHeight ?? 0) + 16;
      const outOfView = rect.top < topInset || rect.bottom > window.innerHeight - 40;
      if (!outOfView) return;
      lastAutoScroll.current = Date.now();
      const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      window.scrollTo({ top: window.scrollY + rect.top - topInset, behavior: reduceMotion ? "auto" : "smooth" });
    });
    return () => cancelAnimationFrame(frame);
  }, [ttsChunk, followReading]);

  // Người dùng cuộn tay thì tạm dừng bám theo; bấm phát lại để bám tiếp.
  useEffect(() => {
    const pauseOnManualScroll = () => {
      if (Date.now() - lastAutoScroll.current > 800 && followReadingRef.current) {
        followReadingRef.current = false;
        setFollowReading(false);
      }
    };
    window.addEventListener("wheel", pauseOnManualScroll, { passive: true });
    window.addEventListener("touchmove", pauseOnManualScroll, { passive: true });
    return () => {
      window.removeEventListener("wheel", pauseOnManualScroll);
      window.removeEventListener("touchmove", pauseOnManualScroll);
    };
  }, []);

  if (bookQuery.isLoading || chapterQuery.isLoading) return <main className="grid min-h-screen place-items-center reading-surface text-muted"><div>Đang mở chương…{reading && <button className="ml-3 rounded-full border px-3 py-2" onClick={() => useTtsSession.setState({ running: false, autoplayChapterId: "" })}>■ Dừng</button>}</div></main>;
  if (bookQuery.isError || chapterQuery.isError || !bookQuery.data || !chapterQuery.data) return <main className="grid min-h-screen place-items-center reading-surface"><Link className="text-stone-600 underline" href="/library">Không tìm thấy chapter. Về thư viện</Link></main>;
  const chapterIndex = bookQuery.data.chapters.findIndex((chapter) => chapter.id === chapterId);
  const previousChapter = bookQuery.data.chapters[chapterIndex - 1];
  const nextChapter = bookQuery.data.chapters[chapterIndex + 1];
  const themeStyle = "reading-surface";
  const textStyleClass = { compact: "text-lg leading-8", comfortable: "text-xl leading-9", large: "text-2xl leading-10" }[textStyle];
  const bookmarkPosition = ttsChunk?.startCharacter ?? progressQuery.data?.characterPosition ?? 0;
  function setFollow(value: boolean) {
    followReadingRef.current = value;
    setFollowReading(value);
  }

  function handleTtsChunk(chunk: TtsChunk | null, info?: { auto: boolean }) {
    // Bấm nút phát (không phải tự chuyển đoạn) thì bám theo trở lại.
    if (chunk && !info?.auto && !followReadingRef.current) setFollow(true);
    setTtsChunk(chunk);
    if (chunk) persistProgress({ nextChapterId: chapterId, characterPosition: chunk.startCharacter });
  }

  return <main className={`min-h-screen ${themeStyle}`}>
    <header className="site-header sticky top-0 z-20"><Link className="wordmark" href={`/library/${bookId}`}>Gác Sách</Link><span className="max-w-48 truncate text-sm text-muted">{bookQuery.data.title}</span></header>
    <article className={`mx-auto reader-column px-6 py-8 md:px-8 ${textStyleClass}`}><p className="font-sans text-sm text-muted">{bookQuery.data.author}</p><h1 className="mt-2 text-3xl font-semibold tracking-tight md:text-4xl">{chapterQuery.data.title}</h1>

      <div ref={playerContainerRef} className={`sticky top-16 z-10 mt-5 rounded-xl reader-dock ${themeStyle}`}><TtsPlayer readerSettings={<div className="reader-settings"><span className="mr-1 self-center text-muted">Giao diện</span>{(["light", "sepia", "dark"] as const).map((option) => <button className="rounded-full border border-current/20 px-3 py-1.5 hover:bg-current/10" aria-pressed={theme === option} key={option} onClick={() => setTheme(option)}>{option === "light" ? "Sáng" : option === "sepia" ? "Giấy" : "Tối"}</button>)}<span className="ml-2 self-center text-muted">Cỡ chữ</span>{(["compact", "comfortable", "large"] as const).map((option) => <button className="rounded-full border border-current/20 px-3 py-1.5 hover:bg-current/10" aria-pressed={textStyle === option} key={option} onClick={() => setTextStyle(option)}>{option === "compact" ? "Nhỏ" : option === "comfortable" ? "Vừa" : "Lớn"}</button>)}</div>} key={chapterId} chapterId={chapterId} initialPosition={progressQuery.isLoading ? undefined : progressQuery.data?.chapterId === chapterId ? progressQuery.data.characterPosition : 0} onProgress={handleTtsProgress} onChunkChange={handleTtsChunk} onComplete={() => {
        if (!useTtsSession.getState().running) return;
        if (nextChapter) selectChapter(nextChapter.id, true);
        else useTtsSession.setState({ running: false, autoplayChapterId: "" });
      }} /></div>
      <div className="mt-4 flex flex-wrap items-center gap-3 font-sans text-sm"><button className="rounded-full border border-current/20 px-3 py-2 hover:bg-current/10 disabled:opacity-50" disabled={bookmarkMutation.isPending} onClick={() => bookmarkMutation.mutate(bookmarkPosition)}>🔖 Lưu dấu trang</button><button className="rounded-full border border-current/20 px-3 py-2 hover:bg-current/10" aria-pressed={followReading} title={followReading ? "Đang bám theo đoạn đọc" : "Đã tạm dừng bám theo"} onClick={() => setFollow(!followReading)}>{followReading ? "👁 Bám theo đoạn đọc" : "👁‍🗨 Đã dừng bám theo"}</button><span className="text-muted">{bookmarksQuery.data?.length ?? 0} dấu trang</span></div>
      <div ref={textContainerRef} className="reader-text mt-8 whitespace-pre-line [&_mark]:transition-colors">{highlightedText(chapterQuery.data.plainText, ttsChunk ? [ttsChunk] : [], ttsChunk?.chunkIndex ?? null)}</div>
      {bookmarksQuery.data && bookmarksQuery.data.length > 0 && <ul className="mt-8 space-y-2 border-t border-current/10 pt-4 font-sans text-sm">{bookmarksQuery.data.slice(0, 8).map((bookmark) => <li className="flex items-center justify-between gap-2 opacity-80" key={bookmark.id}><span>Vị trí {bookmark.characterPosition}</span><button className="underline" onClick={() => removeBookmark.mutate(bookmark.id)}>Xóa</button></li>)}</ul>}
      <footer className="mt-14 flex justify-between border-t border-current/10 pt-5 font-sans text-sm"><button className="rounded-full px-3 py-2 opacity-70 hover:bg-current/10 disabled:invisible" disabled={!previousChapter} onClick={() => previousChapter && selectChapter(previousChapter.id)}>← Chương trước</button><button className="rounded-full px-3 py-2 opacity-70 hover:bg-current/10 disabled:invisible" disabled={!nextChapter} onClick={() => nextChapter && selectChapter(nextChapter.id)}>Chương sau →</button></footer>
    </article>
  </main>;
}
