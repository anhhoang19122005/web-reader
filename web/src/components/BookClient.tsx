"use client";

import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { getBook, getProgress } from "../lib/api";
import { BookMark } from "./BookMark";

export function BookClient({ bookId }: { bookId: string }) {
  const [search, setSearch] = useState("");
  const bookQuery = useQuery({ queryKey: ["book", bookId], queryFn: () => getBook(bookId) });
  const progressQuery = useQuery({ queryKey: ["progress", bookId], queryFn: () => getProgress(bookId) });
  useEffect(() => { if (!bookQuery.data) return; const timer = setTimeout(() => { document.title = `${bookQuery.data.title} · Gác Sách`; }, 0); return () => clearTimeout(timer); }, [bookQuery.data]);
  const fold = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[đĐ]/g, "d").toLowerCase();
  const currentNumber = bookQuery.data?.chapters.find((chapter) => chapter.id === progressQuery.data?.chapterId)?.chapterNumber ?? 0;
  if (bookQuery.isLoading) return <Loading />;
  if (bookQuery.isError || !bookQuery.data) return <MissingBook />;
  const continueChapterId = progressQuery.data?.chapterId ?? bookQuery.data.chapters[0]?.id;

  return <main className="min-h-screen app-surface">
    <header className="site-header"><Link className="wordmark" href="/library">Gác Sách</Link></header>
    <section className="mx-auto max-w-3xl px-5 py-12 md:px-8">
      <Link className="text-sm text-muted hover:text-stone-900" href="/library">← Thư viện</Link>
      <div className="mt-8 flex items-center gap-5"><div className="sr-only">Sách</div><BookMark title={bookQuery.data.title} bookId={bookId} hasCover={bookQuery.data.hasCover} /><div><p className="text-sm text-muted">{bookQuery.data.author}</p><h1 className="section-title">{bookQuery.data.title}</h1></div></div>
      {continueChapterId && <Link className="primary-button mt-8" href={`/reader/${bookId}/${continueChapterId}`}>{progressQuery.data?.chapterId ? `Đọc tiếp · Chương ${currentNumber}` : "Bắt đầu đọc"}</Link>}
      <h2 className="mt-12 text-lg font-semibold">Mục lục</h2><p className="subtle mt-1">{bookQuery.data.chapters.length} chương · Chọn một chương để bắt đầu</p><label className="block mt-5">Tìm chương<input className="chapter-search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Tên hoặc số chương" /></label><ol className="chapter-list">{bookQuery.data.chapters.filter((chapter) => fold(`${chapter.chapterNumber} ${chapter.title}`).includes(fold(search))).map((chapter) => <li key={chapter.id}><Link aria-current={progressQuery.data?.chapterId === chapter.id ? "true" : undefined} href={`/reader/${bookId}/${chapter.id}`}><span>{chapter.chapterNumber}. {chapter.title}</span><span className="text-sm text-muted">{chapter.chapterNumber < currentNumber ? "Đã đọc tới" : chapter.chapterNumber === currentNumber ? "Đang đọc" : "Chưa đọc"}</span></Link></li>)}</ol>
    </section>
  </main>;
}

function Loading() { return <main className="app-surface min-h-screen p-8" aria-busy="true"><p className="subtle">Đang mở sách…</p><div className="reader-skeleton mx-auto max-w-2xl" aria-hidden="true">{[1,2,3].map((id) => <div key={id} />)}</div></main>; }
function MissingBook() { return <main className="grid min-h-screen place-items-center app-surface"><Link className="text-muted underline" href="/library">Không tìm thấy sách. Về thư viện</Link></main>; }
