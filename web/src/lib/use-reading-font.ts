"use client";
import { useEffect } from "react";
import { loadReadingFont } from "./load-reading-font";
import type { ReadingFont } from "./reading-fonts";

/** Loads the selected reading font on demand and exposes its CSS variable on <html>. */
export function useReadingFont(font: ReadingFont) {
  useEffect(() => {
    let cancelled = false;
    loadReadingFont(font).then((variableClass) => {
      if (!cancelled && variableClass) document.documentElement.classList.add(...variableClass.split(" "));
    }).catch(() => undefined); // offline: the stack below falls back to Georgia / Arial
    return () => { cancelled = true; };
  }, [font]);
}
