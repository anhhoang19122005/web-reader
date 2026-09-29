"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { createBookmark, deleteBookmark, getBook, getBookmarks, getChapter, getProgress, saveProgress, TtsChunk } from "../lib/api";
import { TtsPlayer } from "./TtsPlayer";

function highlightedText(text: string, chunks: TtsChunk[], activeChunk: number | null): ReactNode[] {
  const nodes: ReactNode[] = [];
  let cursor = 0;
  chunks.forEach((chunk) => {
    const start = Math.max(cursor, chunk.startCharacter);
    const end = Math.min(text.length, chunk.endCharacter);
    if (start > cursor) nodes.push(<span key={`text-${cursor}`}>{text.slice(cursor, start)}</span>);
    if (end > start) nodes.push(<mark className={activeChunk === chunk.chunkIndex ? "rounded bg-amber-300/70 text-inherit" : "rounded bg-transparent text-inherit"} key={`chunk-${chunk.chunkIndex}`}>{text.slice(start, end)}</mark>);
    cursor = Math.max(cursor, end);
  });
  if (cursor < text.length) nodes.push(<span key={`text-${cursor}`}>{text.slice(cursor)}</span>);
  return nodes;
}

export function ReaderClient({ bookId, chapterId }: { bookId: string; chapterId: string }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [theme, setTheme] = useState<"light" | "sepia" | "dark">("sepia");
  const [textStyle, setTextStyle] = useState<"compact" | "comfortable" | "large">("comfortable");
  const [ttsChunk, setTtsChunk] = useState<TtsChunk | null>(null);
  const bookQuery = useQuery({ queryKey: ["book", bookId], queryFn: () => getBook(bookId) });
  const chapterQuery = useQuery({ queryKey: ["chapter", bookId, chapterId], queryFn: () => getChapter(bookId, chapterId) });
  const progressQuery = useQuery({ queryKey: ["progress", bookId], queryFn: () => getProgress(bookId) });
  const bookmarksQuery = useQuery({ queryKey: ["bookmarks", bookId], queryFn: () => getBookmarks(bookId) });
  const { mutate: persistProgress } = useMutation({ mutationFn: ({ nextChapterId, characterPosition }: { nextChapterId: string; characterPosition: number }) => saveProgress(bookId, nextChapterId, characterPosition) });
  const bookmarkMutation = useMutation({ mutationFn: (position: number) => createBookmark(bookId, { chapterId, characterPosition: position }), onSuccess: () => queryClient.invalidateQueries({ queryKey: ["bookmarks", bookId] }) });
  const removeBookmark = useMutation({ mutationFn: (bookmarkId: string) => deleteBookmark(bookId, bookmarkId), onSuccess: () => queryClient.invalidateQueries({ queryKey: ["bookmarks", bookId] }) });
  const chapterText = chapterQuery.data?.plainText;

  function selectChapter(nextChapterId: string) {
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
      clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => {
        const maxScroll = document.documentElement.scrollHeight - window.innerHeight;
        const ratio = maxScroll > 0 ? window.scrollY / maxScroll : 0;
        persistProgress({ nextChapterId: chapterId, characterPosition: Math.round(ratio * chapterText.length) });
      }, 1500);
    };
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => { window.removeEventListener("scroll", handleScroll); clearTimeout(saveTimer.current); };
  }, [chapterId, chapterText, persistProgress]);

  if (bookQuery.isLoading || chapterQuery.isLoading) return <main className="grid min-h-screen place-items-center bg-[#f4efe7] text-stone-500">Đang mở chapter…</main>;
  if (bookQuery.isError || chapterQuery.isError || !bookQuery.data || !chapterQuery.data) return <main className="grid min-h-screen place-items-center bg-[#f4efe7]"><Link className="text-stone-600 underline" href="/library">Không tìm thấy chapter. Về thư viện</Link></main>;
  const chapterIndex = bookQuery.data.chapters.findIndex((chapter) => chapter.id === chapterId);
  const previousChapter = bookQuery.data.chapters[chapterIndex - 1];
  const nextChapter = bookQuery.data.chapters[chapterIndex + 1];
  const themeStyle = { light: "bg-stone-50 text-stone-800", sepia: "bg-[#f4efe7] text-stone-800", dark: "bg-stone-950 text-stone-100" }[theme];
  const textStyleClass = { compact: "text-lg leading-8", comfortable: "text-xl leading-9", large: "text-2xl leading-10" }[textStyle];
  const bookmarkPosition = ttsChunk?.startCharacter ?? progressQuery.data?.characterPosition ?? 0;
  function handleTtsChunk(chunk: TtsChunk | null) {
    setTtsChunk(chunk);
    if (chunk) persistProgress({ nextChapterId: chapterId, characterPosition: chunk.startCharacter });
  }

  return <main className={`min-h-screen ${themeStyle}`}>
    <header className={`sticky top-0 z-10 flex h-16 items-center justify-between border-b border-stone-200 px-5 backdrop-blur md:px-8 ${theme === "dark" ? "bg-stone-950/95" : "bg-[#fbf8f2]/95"}`}><Link className="font-serif text-xl font-semibold tracking-tight" href={`/library/${bookId}`}>Gác Sách</Link><span className="max-w-48 truncate text-sm opacity-60">{bookQuery.data.title}</span></header>
    <article className={`mx-auto max-w-2xl px-5 py-12 font-serif md:px-8 ${textStyleClass}`}><p className="font-sans text-sm opacity-60">{bookQuery.data.author}</p><h1 className="mt-2 text-3xl font-semibold tracking-tight md:text-4xl">{chapterQuery.data.title}</h1>
      <div className="mt-8 flex flex-wrap gap-2 border-y border-current/10 py-3 font-sans text-xs"><span className="mr-1 self-center opacity-60">Giao diện</span>{(["light", "sepia", "dark"] as const).map((option) => <button className="rounded-full border border-current/20 px-3 py-1.5 hover:bg-current/10" aria-pressed={theme === option} key={option} onClick={() => setTheme(option)}>{option === "light" ? "Sáng" : option === "sepia" ? "Giấy" : "Tối"}</button>)}<span className="ml-2 self-center opacity-60">Cỡ chữ</span>{(["compact", "comfortable", "large"] as const).map((option) => <button className="rounded-full border border-current/20 px-3 py-1.5 hover:bg-current/10" aria-pressed={textStyle === option} key={option} onClick={() => setTextStyle(option)}>{option === "compact" ? "Nhỏ" : option === "comfortable" ? "Vừa" : "Lớn"}</button>)}</div>
      <div className="mt-5"><TtsPlayer chapterId={chapterId} onChunkChange={handleTtsChunk} onComplete={() => nextChapter && selectChapter(nextChapter.id)} /></div>
      <div className="mt-4 flex flex-wrap items-center gap-3 font-sans text-sm"><button className="rounded-full border border-current/20 px-3 py-2 hover:bg-current/10 disabled:opacity-50" disabled={bookmarkMutation.isPending} onClick={() => bookmarkMutation.mutate(bookmarkPosition)}>🔖 Lưu dấu trang</button><span className="opacity-60">{bookmarksQuery.data?.length ?? 0} dấu trang</span></div>
      <div className="mt-8 whitespace-pre-wrap [&_mark]:transition-colors">{highlightedText(chapterQuery.data.plainText, ttsChunk ? [ttsChunk] : [], ttsChunk?.chunkIndex ?? null)}</div>
      {bookmarksQuery.data && bookmarksQuery.data.length > 0 && <ul className="mt-8 space-y-2 border-t border-current/10 pt-4 font-sans text-sm">{bookmarksQuery.data.slice(0, 8).map((bookmark) => <li className="flex items-center justify-between gap-2 opacity-80" key={bookmark.id}><span>Vị trí {bookmark.characterPosition}</span><button className="underline" onClick={() => removeBookmark.mutate(bookmark.id)}>Xóa</button></li>)}</ul>}
      <footer className="mt-14 flex justify-between border-t border-current/10 pt-5 font-sans text-sm"><button className="rounded-full px-3 py-2 opacity-70 hover:bg-current/10 disabled:invisible" disabled={!previousChapter} onClick={() => previousChapter && selectChapter(previousChapter.id)}>← Chương trước</button><button className="rounded-full px-3 py-2 opacity-70 hover:bg-current/10 disabled:invisible" disabled={!nextChapter} onClick={() => nextChapter && selectChapter(nextChapter.id)}>Chương sau →</button></footer>
    </article>
  </main>;
}
