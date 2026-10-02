"use client";

import { useEffect } from "react";
import { getReadingPreferences, patchReadingPreferences } from "../lib/api";
import { preferenceKeys, useReadingPreferences, validPreferences, type ReadingPreferences } from "../lib/reading-preferences";

export function PreferencesSync() {
  useEffect(() => {
    let disposed = false;
    let applying = false;
    let busy = false;
    let initialized = false;
    let needsRefresh = false;
    let timer: ReturnType<typeof setTimeout>;
    const controller = new AbortController();
    const apply = (values: Partial<ReturnType<typeof useReadingPreferences.getState>>) => {
      applying = true; useReadingPreferences.setState(values); applying = false;
    };
    const schedule = () => { clearTimeout(timer); timer = setTimeout(() => void flush(), 500); };
    async function flush() {
      if (busy || disposed || !initialized) return;
      const pending = { ...useReadingPreferences.getState().pending };
      if (!Object.keys(pending).length) return;
      busy = true;
      try {
        await patchReadingPreferences(pending, AbortSignal.any([controller.signal, AbortSignal.timeout(10000)]));
        if (disposed) return;
        const remaining = { ...useReadingPreferences.getState().pending };
        for (const key of preferenceKeys) if (remaining[key] === pending[key]) delete remaining[key];
        apply({ pending: remaining, syncStatus: Object.keys(remaining).length ? "pending" : "saved" });
        if (Object.keys(remaining).length) schedule();
      } catch { if (!disposed) { apply({ syncStatus: "offline" }); timer = setTimeout(() => void refresh(), 10000); } }
      finally { busy = false; if (needsRefresh && !disposed) { needsRefresh = false; void refresh(); } }
    }
    async function refresh() {
      if (disposed || document.hidden) return;
      if (busy) { needsRefresh = true; return; }
      busy = true;
      let fetched = false;
      try {
        const response = await getReadingPreferences(AbortSignal.any([controller.signal, AbortSignal.timeout(5000)]));
        initialized = true; fetched = true;
        if (disposed) return;
        const state = useReadingPreferences.getState();
        let pending = state.pending;
        if (response.preferences === null) {
          pending = Object.fromEntries(preferenceKeys.map((key) => [key, state[key]])) as ReadingPreferences;
        }
        apply({ ...validPreferences(response.preferences), ...pending, pending, ready: true, syncStatus: Object.keys(pending).length ? "pending" : "saved" });
      } catch { if (!disposed) { apply({ ready: true, syncStatus: "offline" }); timer = setTimeout(() => void refresh(), 10000); } }
      finally { busy = false; if (!disposed && fetched) schedule(); if (needsRefresh && !disposed) { needsRefresh = false; void refresh(); } }
    }
    const unsubscribe = useReadingPreferences.subscribe((state, previous) => {
      if (applying) return;
      const changed = Object.fromEntries(preferenceKeys.filter((key) => state[key] !== previous[key]).map((key) => [key, state[key]]));
      if (!Object.keys(changed).length) return;
      apply({ pending: { ...state.pending, ...changed }, syncStatus: "pending" });
      schedule();
    });
    const retry = () => { if (!document.hidden) void refresh(); };
    applying = true;
    void Promise.resolve(useReadingPreferences.persist.rehydrate()).then(() => { applying = false; if (!disposed) { apply({ ready: true }); void refresh(); } });
    window.addEventListener("online", retry);
    window.addEventListener("focus", retry);
    document.addEventListener("visibilitychange", retry);
    return () => {
      disposed = true; clearTimeout(timer); controller.abort(); unsubscribe();
      window.removeEventListener("online", retry); window.removeEventListener("focus", retry); document.removeEventListener("visibilitychange", retry);
    };
  }, []);
  return null;
}
