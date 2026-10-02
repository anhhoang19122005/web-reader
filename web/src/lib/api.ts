import type { ReadingPreferences } from "./reading-preferences";
export type BookSummary = {
  id: string;
  title: string;
  author: string;
  fileType: "EPUB" | "PDF";
  hasCover: boolean;
  chapterCount: number;
  createdAt: string;
  progressPercent: number;
  lastReadAt: string | null;
  continueChapterId?: string | null; continueChapterNumber?: number; continueChapterTitle?: string;
};

export type Book = {
  id: string;
  title: string;
  author: string;
  fileType: "EPUB" | "PDF";
  hasCover: boolean;
  createdAt: string;
  chapters: ChapterSummary[];
};

export type ChapterSummary = {
  id: string;
  chapterNumber: number;
  title: string;
};

export type Chapter = ChapterSummary & {
  contentHtml: string;
  plainText: string;
};

export type ReadingProgress = {
  bookId: string;
  chapterId: string | null;
  characterPosition: number;
  updatedAt: string | null;
};

export type TtsVoice = { id: string; provider: string; name: string; language: string; gender: string; style: string };
export type TtsChunk = { chunkIndex: number; text: string; startCharacter: number; endCharacter: number };
export type TtsGenerateResponse = { audioUrl: string; mimeType: string; durationMs: number; chunkIndex: number; startCharacter: number; endCharacter: number; cached: boolean };
export type Bookmark = { id: string; chapterId: string; characterPosition: number; note: string | null; excerpt?: string; chapterTitle?: string; createdAt: string };

type ApiError = { message?: string };

const baseUrl = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8080/api";
export const apiUrl = (path: string) => `${baseUrl}${path}`;

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(apiUrl(path), init);
  if (!response.ok) {
    const error = (await response.json().catch(() => ({}))) as ApiError;
    throw new Error(error.message ?? "Không thể kết nối tới thư viện.");
  }
  if (response.status === 204) return undefined as T;
  if ((!init?.method || init.method === "GET") && /^\/books(?:\/[^/]+(?:\/chapters\/[^/]+)?)?$/.test(path) && typeof window !== "undefined" && "caches" in window) {
    const copy = response.clone();
    void (async () => {
      try {
        const cache = await caches.open("gac-sach-content-v1");
        const key = `/api${path}`;
        await cache.delete(key); await cache.put(key, copy);
        const keys = await cache.keys();
        for (const old of keys.slice(0, Math.max(0, keys.length - 40))) await cache.delete(old);
      } catch { /* Reading continues if browser storage is full/unavailable. */ }
    })();
  }
  return response.json() as Promise<T>;
}

export const getBooks = () => request<BookSummary[]>("/books");
export const getBook = (bookId: string) => request<Book>(`/books/${bookId}`);
export const getChapter = (bookId: string, chapterId: string) => request<Chapter>(`/books/${bookId}/chapters/${chapterId}`);
export const getProgress = (bookId: string) => request<ReadingProgress>(`/reader/progress/${bookId}`);

export const saveProgress = (bookId: string, chapterId: string, characterPosition: number) => request<ReadingProgress>(`/reader/progress/${bookId}`, {
  method: "PUT",
  keepalive: true,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ chapterId, characterPosition }),
});

export const uploadBook = async (file: File, stage?: (stage: "uploading" | "parsing") => void) => {
  if (!/\.(epub|pdf)$/i.test(file.name)) throw new Error("Chỉ hỗ trợ tệp EPUB hoặc PDF.");
  if (file.size === 0 || file.size > 50 * 1024 * 1024) throw new Error("Tệp phải có nội dung và không vượt quá 50 MB.");
  stage?.("uploading");
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (supabaseUrl && supabaseAnonKey) {
    const signedUpload = await request<{ path: string; token: string; bucket: string }>("/uploads/sign", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ filename: file.name }),
    });
    const storage = createClient(supabaseUrl, supabaseAnonKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const { error } = await storage.storage.from(signedUpload.bucket).uploadToSignedUrl(signedUpload.path, signedUpload.token, file, { contentType: file.type || undefined });
    if (error) throw new Error("Không thể upload tệp lên storage.");
    stage?.("parsing");
    return request<{ id: string }>("/books/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ storageKey: signedUpload.path }),
    });
  }
  const formData = new FormData();
  formData.append("file", file);
  return new Promise<{ id: string }>((resolve, reject) => {
    const upload = new XMLHttpRequest();
    upload.open("POST", apiUrl("/books/upload")); upload.timeout = 240_000;
    upload.upload.addEventListener("load", () => stage?.("parsing"));
    upload.onload = () => {
      try {
        const result = JSON.parse(upload.responseText);
        if (upload.status >= 200 && upload.status < 300) resolve(result);
        else reject(new Error(result.message ?? "Không nhập được tệp sách."));
      } catch { reject(new Error("Máy chủ trả về dữ liệu không hợp lệ.")); }
    };
    upload.onerror = () => reject(new Error("Mất kết nối khi tải tệp lên."));
    upload.ontimeout = () => reject(new Error("Xử lý tệp quá lâu. Hãy thử lại với tệp nhỏ hơn."));
    upload.send(formData);
  });
};
export const deleteBook = async (bookId: string) => {
  await request<void>(`/books/${bookId}`, { method: "DELETE" });
  try {
    const cache = await caches.open("gac-sach-content-v1");
    const prefix = `/api/books/${encodeURIComponent(bookId)}`;
    for (const key of await cache.keys()) { const path = new URL(key.url).pathname; if (path === prefix || path.startsWith(prefix + "/")) await cache.delete(key); }
    await cache.delete("/api/books");
    const queued = JSON.parse(localStorage.getItem("gac-sach-offline-progress") || "{}");
    delete queued[bookId]; localStorage.setItem("gac-sach-offline-progress", JSON.stringify(queued));
  } catch { /* Deletion succeeded even when offline storage is unavailable. */ }
};

export const restoreBook = (bookId: string) => request<void>(`/books/${bookId}/restore`, { method: "POST" });

export const getTtsVoices = () => request<TtsVoice[]>("/tts/voices");
export const getTtsChunks = (chapterId: string) => request<TtsChunk[]>(`/tts/chunks/${chapterId}`);
export const generateTts = (payload: { chapterId: string; chunkIndex: number; voiceId: string; speakingRate: number; pitch: number; volume: number }) => request<TtsGenerateResponse>("/tts/generate", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(payload),
});
export const getBookmarks = (bookId: string) => request<Bookmark[]>(`/reader/bookmarks/${bookId}`);
export const createBookmark = (bookId: string, payload: { chapterId: string; characterPosition: number; note?: string }) => request<Bookmark>(`/reader/bookmarks/${bookId}`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(payload),
});
export const deleteBookmark = (bookId: string, bookmarkId: string) => request<void>(`/reader/bookmarks/${bookId}/${bookmarkId}`, { method: "DELETE" });
import { createClient } from "@supabase/supabase-js";

export type PreferencesResponse = { preferences: Partial<ReadingPreferences> | null; updatedAt: string | null };
export const getReadingPreferences = (signal?: AbortSignal) => request<PreferencesResponse>("/reader/preferences", { signal });
export const patchReadingPreferences = (values: Partial<ReadingPreferences>, signal?: AbortSignal) => request<PreferencesResponse>("/reader/preferences", {
  method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(values), signal,
});
