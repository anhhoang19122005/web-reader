"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { getBook, getProgress } from "../lib/api";
import { BookMark } from "./BookMark";

export function BookClient({ bookId }: { bookId: string }) {
  const bookQuery = useQuery({ queryKey: ["book", bookId], queryFn: () => getBook(bookId) });
  const progressQuery = useQuery({ queryKey: ["progress", bookId], queryFn: () => getProgress(bookId) });
  if (bookQuery.isLoading) return <Loading />;
  if (bookQuery.isError || !bookQuery.data) return <MissingBook />;
  const continueChapterId = progressQuery.data?.chapterId ?? bookQuery.data.chapters[0]?.id;

  return <main className="min-h-screen bg-[#f4efe7] text-stone-900">
    <header className="flex h-16 items-center border-b border-stone-200 bg-[#fbf8f2] px-5 md:px-8"><Link className="font-serif text-xl font-semibold tracking-tight" href="/library">Gác Sách</Link></header>
    <section className="mx-auto max-w-3xl px-5 py-12 md:px-8">
      <Link className="text-sm text-stone-500 hover:text-stone-900" href="/library">← Thư viện</Link>
      <div className="mt-8 flex items-center gap-5"><BookMark title={bookQuery.data.title} /><div><p className="text-sm text-stone-500">{bookQuery.data.author}</p><h1 className="font-serif text-4xl font-semibold tracking-tight">{bookQuery.data.title}</h1></div></div>
      {continueChapterId && <Link className="mt-8 inline-block rounded-full bg-stone-900 px-5 py-3 text-sm font-medium text-white hover:bg-stone-700" href={`/reader/${bookId}/${continueChapterId}`}>{progressQuery.data?.chapterId ? "Đọc tiếp" : "Bắt đầu đọc"}</Link>}
      <ol className="mt-10 divide-y divide-stone-200 border-y border-stone-200">{bookQuery.data.chapters.map((chapter) => <li key={chapter.id}><Link className="flex items-center justify-between py-4 hover:text-amber-800" href={`/reader/${bookId}/${chapter.id}`}><span>{chapter.chapterNumber}. {chapter.title}</span><span className="text-sm text-stone-400">Đọc →</span></Link></li>)}</ol>
    </section>
  </main>;
}

function Loading() { return <main className="grid min-h-screen place-items-center bg-[#f4efe7] text-stone-500">Đang mở sách…</main>; }
function MissingBook() { return <main className="grid min-h-screen place-items-center bg-[#f4efe7]"><Link className="text-stone-600 underline" href="/library">Không tìm thấy sách. Về thư viện</Link></main>; }
