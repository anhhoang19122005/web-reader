"use client";

import { useEffect } from "react";
import { useReaderSession } from "../lib/reading-preferences";

// Lives in the /reader/[bookId] layout, which stays mounted while the reader moves between
// chapters, so focus mode survives a chapter change and only turns off when the book is left.
export function ReaderFocusReset() {
  useEffect(() => () => { useReaderSession.setState({ focus: false }); }, []);
  return null;
}
