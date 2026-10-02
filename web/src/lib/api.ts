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
export type Bookmark = { id: string; chapterId: string; characterPosition: number; note: string | null; createdAt: string };

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

export const uploadBook = async (file: File) => {
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
    return request<{ id: string }>("/books/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ storageKey: signedUpload.path }),
    });
  }
  const formData = new FormData();
  formData.append("file", file);
  return request<{ id: string }>("/books/upload", { method: "POST", body: formData });
};
export const deleteBook = (bookId: string) => request<void>(`/books/${bookId}`, { method: "DELETE" });

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
