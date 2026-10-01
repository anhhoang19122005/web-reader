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

  const books = [...(booksQuery.data ?? [])].sort((a, b) => (b.lastReadAt ?? "").localeCompare(a.lastReadAt ?? ""));
  const recent = books.find((book) => book.lastReadAt);
  return <main className="min-h-screen app-surface">
    <header className="site-header">
      <span className="wordmark">Gác Sách</span>
      <label className="primary-button cursor-pointer upload-button">
        {uploadMutation.isPending ? "Đang nhập…" : "Nhập EPUB/PDF"}
        <input className="sr-only" type="file" accept=".epub,.pdf,application/epub+zip,application/pdf" onChange={chooseFile} disabled={uploadMutation.isPending} />
      </label>
    </header>
    <section className="mx-auto max-w-5xl px-5 py-12 md:px-8">
      <div className="library-intro"><h1 className="section-title">Một góc yên, một câu chuyện.</h1><p>Những cuốn sách của bạn, luôn ở đây. Đọc vài trang hoặc để một giọng kể đưa bạn đi xa hơn.</p></div>
      {recent && <section className="mt-8 flex flex-wrap items-center justify-between gap-4 border-b border-current/15 pb-8" aria-label="Đọc gần đây"><div><p className="text-muted text-sm">Trở lại câu chuyện đang đọc</p><h2 className="book-title mt-2">{recent.title}</h2><p className="subtle mt-1">{recent.progressPercent}% đã đọc</p></div><Link className="primary-button" href={`/library/${recent.id}`}>Đọc tiếp →</Link></section>}
      <div className="mt-8 flex items-center justify-between"><h2 className="text-lg font-semibold">Kệ sách của bạn</h2><span className="subtle">{books.length} cuốn sách</span></div>
      {booksQuery.isLoading && <p className="mt-10 text-muted">Đang tải sách…</p>}
      {booksQuery.isError && <p className="mt-10 error-message">Không tải được thư viện.</p>}
      {!booksQuery.isLoading && booksQuery.data?.length === 0 && <EmptyLibrary />}
      <div className="shelf">
        {books.map((book) => <div className="book-row" key={book.id}>
          <Link className="flex min-w-0 flex-1 items-center gap-4" href={`/library/${book.id}`}><BookMark title={book.title} /><span className="min-w-0"><span className="block book-title">{book.title}</span><span className="block truncate text-sm text-muted">{book.author} · {book.chapterCount} chương</span><span className="book-progress" role="progressbar" aria-label="Tiến độ đọc" aria-valuemin={0} aria-valuemax={100} aria-valuenow={book.progressPercent}><span  style={{ width: `${book.progressPercent}%` }} /></span><span className="mt-1 block text-xs text-muted">{book.progressPercent}%{book.lastReadAt ? " · Đã đọc gần đây" : ""}</span></span></Link>
          <button className="font-sans text-xs text-muted underline hover:error-message" disabled={deleteMutation.isPending} onClick={() => { if (window.confirm(`Xóa “${book.title}”?`)) deleteMutation.mutate(book.id); }}>Xóa</button>
        </div>)}
      </div>
      {uploadMutation.isError && <p className="mt-5 text-sm error-message">{uploadMutation.error.message}</p>}
    </section>
  </main>;
}

function EmptyLibrary() {
  return <div className="mt-10 max-w-xl rounded-xl border border-dashed border-current/25 p-8"><p className="font-serif text-2xl font-semibold">Thư viện đang trống</p><p className="mt-2 leading-7 text-muted">Nhập một tệp EPUB hoặc PDF để lưu sách, tách chapter và bắt đầu đọc trên trình duyệt.</p></div>;
}
