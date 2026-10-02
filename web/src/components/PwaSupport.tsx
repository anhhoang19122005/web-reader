"use client";

import { useEffect } from "react";
import { saveProgress } from "../lib/api";

export const offlineProgressKey = "gac-sach-offline-progress";
export function PwaSupport() {
  useEffect(() => {
    if (process.env.NODE_ENV === "production" && "serviceWorker" in navigator) void navigator.serviceWorker.register("/sw.js").then((registration) => registration.active?.postMessage({ type: "REFRESH_SHELL" })).catch(() => undefined);
    let busy = false;
    const sync = async () => {
      if (busy || !navigator.onLine) return;
      busy = true;
      try {
        const pending = JSON.parse(localStorage.getItem(offlineProgressKey) || "{}");
        for (const [bookId, value] of Object.entries(pending) as [string, { chapterId: string; characterPosition: number }][]) {
          try { await saveProgress(bookId, value.chapterId, value.characterPosition); }
          catch { continue; } // One unavailable book must not block other queued books.
          const current = JSON.parse(localStorage.getItem(offlineProgressKey) || "{}");
          if (JSON.stringify(current[bookId]) === JSON.stringify(value)) { delete current[bookId]; localStorage.setItem(offlineProgressKey, JSON.stringify(current)); }
        }
      } catch { /* Keep the queue for the next online/focus event. */ }
      finally { busy = false; }
    };
    void sync(); window.addEventListener("online", sync); window.addEventListener("focus", sync);
    return () => { window.removeEventListener("online", sync); window.removeEventListener("focus", sync); };
  }, []);
  return null;
}
