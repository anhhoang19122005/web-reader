"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { deleteBook, getBooks, restoreBook, uploadBook } from "../lib/api";
import { BookMark } from "./BookMark";
import { Icon } from "./Icon";

type UploadItem = { name: string; stage: "waiting" | "uploading" | "parsing" | "done" | "error"; error?: string };
const stages = { waiting: "Đang chờ", uploading: "Đang tải lên", parsing: "Đang xử lý tệp và tách chương", done: "Đã nhập", error: "Không nhập được" };

export function LibraryClient() {
  const queryClient = useQueryClient();
  const booksQuery = useQuery({ queryKey: ["books"], queryFn: getBooks });
  const [uploads, setUploads] = useState<UploadItem[]>([]);
  const [uploading, setUploading] = useState(false);
  const uploadBusy = useRef(false);
  const [dragging, setDragging] = useState(false);
  const [undo, setUndo] = useState<{ id: string; title: string } | null>(null);
  const [actionError, setActionError] = useState("");
  const deleteMutation = useMutation({ mutationFn: deleteBook, onSuccess: (_, id) => {
    const title = booksQuery.data?.find((book) => book.id === id)?.title ?? "Sách";
    setUndo({ id, title }); setActionError("");
    void queryClient.invalidateQueries({ queryKey: ["books"] });
    navigator.serviceWorker?.controller?.postMessage({ type: "REMOVE_BOOK", bookId: id });
  }, onError: (error) => setActionError(error.message) });
  const undoMutation = useMutation({ mutationFn: restoreBook, onSuccess: () => { setUndo(null); void queryClient.invalidateQueries({ queryKey: ["books"] }); }, onError: (error) => setActionError(error.message) });
  useEffect(() => { if (!undo) return; const timer = setTimeout(() => setUndo(null), 15000); return () => clearTimeout(timer); }, [undo]);

  async function importFiles(files: File[]) {
    if (uploadBusy.current || !files.length) return;
    uploadBusy.current = true; setUploading(true);
    setUploads(files.map((file) => ({ name: file.name, stage: "waiting" })));
    const update = (index: number, values: Partial<UploadItem>) => setUploads((items) => items.map((item, i) => i === index ? { ...item, ...values } : item));
    try {
      for (const [index, file] of files.entries()) {
        try { await uploadBook(file, (stage) => update(index, { stage })); update(index, { stage: "done" }); }
        catch (error) { update(index, { stage: "error", error: error instanceof Error ? error.message : "Không thể nhập tệp." }); }
      }
      await queryClient.invalidateQueries({ queryKey: ["books"] });
    } finally { uploadBusy.current = false; setUploading(false); }
  }
  const books = [...(booksQuery.data ?? [])].sort((a, b) => (b.lastReadAt ?? "").localeCompare(a.lastReadAt ?? ""));
  const recent = books.find((book) => book.lastReadAt);
  return <main className="min-h-screen app-surface">
    <header className="site-header"><span className="wordmark">Gác Sách</span><Link href="/offline" className="subtle">Sách offline</Link></header>
    <section className="mx-auto max-w-5xl px-5 py-12 md:px-8">
      <div className="library-intro"><h1 className="section-title">Một góc yên, một câu chuyện.</h1><p>Những cuốn sách của bạn, luôn ở đây. Đọc vài trang hoặc để một giọng kể đưa bạn đi xa hơn.</p></div>
      {recent && <section className="continue-book" aria-label="Đọc gần đây"><BookMark title={recent.title} bookId={recent.id} hasCover={recent.hasCover} /><div><p className="subtle">Trở lại câu chuyện đang đọc</p><h2 className="book-title mt-2">{recent.title}</h2><p className="subtle mt-1">{recent.continueChapterTitle || "Chương đang đọc"} · {recent.progressPercent}% cả sách</p></div><Link className="primary-button" href={recent.continueChapterId ? `/reader/${recent.id}/${recent.continueChapterId}` : `/library/${recent.id}`}>Đọc tiếp{recent.continueChapterNumber ? ` · Chương ${recent.continueChapterNumber}` : ""}</Link></section>}
      <div className={`upload-zone ${dragging ? "is-dragging" : ""}`} onDragOver={(event) => { event.preventDefault(); setDragging(true); }} onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setDragging(false); }} onDrop={(event) => { event.preventDefault(); setDragging(false); void importFiles([...event.dataTransfer.files]); }}>
        <label className="primary-button cursor-pointer upload-button"><Icon name="upload" />{uploading ? "Đang nhập sách…" : "Nhập EPUB/PDF"}<input className="sr-only" type="file" multiple accept=".epub,.pdf,application/epub+zip,application/pdf" onChange={(event) => { void importFiles([...event.target.files ?? []]); event.target.value = ""; }} disabled={uploading} /></label><p className="subtle">Hoặc kéo thả tệp vào đây · tối đa 50 MB mỗi tệp</p>
      </div>
      {uploads.length > 0 && <ol className="upload-status" aria-live="polite">{uploads.map((item, index) => <li key={index}><strong>{item.name}</strong><span className={item.error ? "error-message" : "subtle"}>{stages[item.stage]}{item.error ? ` · ${item.error}` : ""}</span><progress aria-label={`Tiến trình nhập ${item.name}`} max="3" value={item.stage === "done" ? 3 : item.stage === "uploading" ? 1 : item.stage === "parsing" ? undefined : 0} /></li>)}</ol>}
      <div className="mt-8 flex items-center justify-between"><h2 className="text-lg font-semibold">Kệ sách của bạn</h2><span className="subtle">{books.length} cuốn sách</span></div>
      {booksQuery.isLoading && <div className="library-skeleton" role="status" aria-label="Đang tải sách">{[1,2,3].map((id) => <div key={id}><span /><div className="reader-skeleton"><div /><div /></div></div>)}</div>}
      {booksQuery.isError && <p className="mt-10 error-message">Không tải được thư viện. <button onClick={() => void booksQuery.refetch()}>Thử lại</button></p>}
      {!booksQuery.isLoading && booksQuery.data?.length === 0 && <div className="empty-library"><Icon name="book" /><h2 className="book-title">Thư viện đang trống</h2><p className="text-muted">Nhập EPUB hoặc PDF để bắt đầu đọc.</p></div>}
      <div className="shelf shelf-grid">{books.map((book) => <div className="book-row" key={book.id}><Link className="book-link" href={`/library/${book.id}`}><BookMark title={book.title} bookId={book.id} hasCover={book.hasCover} /><span className="min-w-0"><span className="block book-title">{book.title}</span><span className="block text-sm text-muted">{book.author} · {book.chapterCount} chương</span><span className="book-progress" role="progressbar" aria-label={`Tiến độ ${book.title}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={book.progressPercent}><span style={{ width: `${book.progressPercent}%` }} /></span><span className="mt-1 block subtle">{book.progressPercent}%{book.lastReadAt ? " · Đã đọc gần đây" : ""}</span></span></Link><button className="delete-book" aria-label={`Xóa ${book.title}`} disabled={deleteMutation.isPending} onClick={() => deleteMutation.mutate(book.id)}>Xóa</button></div>)}</div>
      {actionError && <p className="error-message" role="alert">{actionError}</p>}
    </section>
    {undo && <div className="undo-toast" role="status"><span>Đã xóa “{undo.title}”</span><button disabled={undoMutation.isPending} onClick={() => undoMutation.mutate(undo.id)}>Hoàn tác</button></div>}
  </main>;
}
