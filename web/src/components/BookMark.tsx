"use client";

import { useState } from "react";
import { apiUrl } from "../lib/api";

export function BookMark({ title, bookId, hasCover }: { title: string; bookId?: string; hasCover?: boolean }) {
  const [failed, setFailed] = useState(false);
  return <span className="book-cover" aria-hidden="true">{hasCover && bookId && !failed ?
    // Protected API covers use the same browser credentials as the app.
    // eslint-disable-next-line @next/next/no-img-element
    <img src={apiUrl(`/books/${bookId}/cover`)} alt="" loading="lazy" onError={() => setFailed(true)} /> : title.trim().charAt(0) || "S"}</span>;
}
