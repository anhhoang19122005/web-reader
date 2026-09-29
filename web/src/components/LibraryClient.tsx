"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type ChangeEvent } from "react";
import { deleteBook, getBooks, uploadBook } from "../lib/api";
import { BookMark } from "./BookMark";

export function LibraryClient() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const booksQuery = useQuery({ queryKey: ["books"], queryFn: getBooks });
  const uploadMutation = useMutation({
    mutationFn: uploadBook,
    onSuccess: async ({ id }) => {
      await queryClient.invalidateQueries({ queryKey: ["books"] });
      router.push(`/library/${id}`);
    },
  });
  const deleteMutation = useMutation({ mutationFn: deleteBook, onSuccess: () => queryClient.invalidateQueries({ queryKey: ["books"] }) });

  function chooseFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (file) uploadMutation.mutate(file);
    event.target.value = "";
  }

  return <main className="min-h-screen bg-[#f4efe7] text-stone-900">
    <header className="flex h-16 items-center justify-between border-b border-stone-200 bg-[#fbf8f2] px-5 md:px-8">
      <span className="font-serif text-xl font-semibold tracking-tight">Gác Sách</span>
      <label className="cursor-pointer rounded-full bg-stone-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-stone-700">
        {uploadMutation.isPending ? "Đang nhập…" : "Nhập EPUB/PDF"}
        <input className="sr-only" type="file" accept=".epub,.pdf,application/epub+zip,application/pdf" onChange={chooseFile} disabled={uploadMutation.isPending} />
      </label>
    </header>
    <section className="mx-auto max-w-5xl px-5 py-12 md:px-8">
      <p className="text-sm font-semibold tracking-[0.16em] text-amber-800">THƯ VIỆN CỦA BẠN</p>
      <h1 className="mt-3 font-serif text-4xl font-semibold tracking-tight md:text-5xl">Chọn một câu chuyện</h1>
      {booksQuery.isLoading && <p className="mt-10 text-stone-500">Đang tải sách…</p>}
      {booksQuery.isError && <p className="mt-10 text-red-700">Không tải được thư viện.</p>}
      {!booksQuery.isLoading && booksQuery.data?.length === 0 && <EmptyLibrary />}
      <div className="mt-10 grid gap-3 sm:grid-cols-2">
        {booksQuery.data?.map((book) => <div className="flex items-center gap-4 rounded-2xl border border-stone-200 bg-[#fbf8f2] p-4 transition hover:-translate-y-0.5 hover:shadow-sm" key={book.id}>
          <Link className="flex min-w-0 flex-1 items-center gap-4" href={`/library/${book.id}`}><BookMark title={book.title} /><span className="min-w-0"><span className="block truncate font-serif text-xl font-semibold">{book.title}</span><span className="block truncate text-sm text-stone-500">{book.author} · {book.chapterCount} chương</span><span className="mt-2 block h-1.5 w-40 rounded-full bg-stone-200"><span className="block h-full rounded-full bg-amber-700" style={{ width: `${book.progressPercent}%` }} /></span><span className="mt-1 block text-xs text-stone-400">{book.progressPercent}%{book.lastReadAt ? " · Đã đọc gần đây" : ""}</span></span></Link>
          <button className="font-sans text-xs text-stone-400 underline hover:text-red-700" disabled={deleteMutation.isPending} onClick={() => { if (window.confirm(`Xóa “${book.title}”?`)) deleteMutation.mutate(book.id); }}>Xóa</button>
        </div>)}
      </div>
      {uploadMutation.isError && <p className="mt-5 text-sm text-red-700">{uploadMutation.error.message}</p>}
    </section>
  </main>;
}

function EmptyLibrary() {
  return <div className="mt-10 max-w-xl rounded-2xl border border-dashed border-stone-300 bg-[#fbf8f2] p-8"><p className="font-serif text-2xl font-semibold">Thư viện đang trống</p><p className="mt-2 leading-7 text-stone-600">Nhập một tệp EPUB hoặc PDF để lưu sách, tách chapter và bắt đầu đọc trên trình duyệt.</p></div>;
}
