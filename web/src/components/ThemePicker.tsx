"use client";

import { useId } from "react";
import { usePathname } from "next/navigation";
import { readingThemes, useReadingPreferences } from "../lib/reading-preferences";

export function ThemePicker() {
  const id = useId();
  const path = usePathname();
  const theme = useReadingPreferences((state) => state.theme);
  const ready = useReadingPreferences((state) => state.ready);

  // Reader already exposes the same themes in Aa; keep controls off the text.
  if (path.startsWith("/reader/")) return null;

  return <>
    <button type="button" className="theme-picker-trigger" popoverTarget={id} disabled={!ready}>Giao diện</button>
    <div id={id} popover="auto" className="reader-settings-popover theme-picker-panel" aria-labelledby={`${id}-title`}>
      <div className="drawer-header">
        <h2 id={`${id}-title`}>Giao diện</h2>
        <button type="button" className="settings-close" popoverTarget={id} popoverTargetAction="hide" aria-label="Đóng chọn giao diện">Đóng</button>
      </div>
      <div className="theme-options" role="group" aria-label="Theme giao diện">
        {readingThemes.map((option) => <button type="button" className="theme-option" aria-pressed={theme === option.id} key={option.id} onClick={() => useReadingPreferences.setState({ theme: option.id })}>
          <span className="theme-swatch" aria-hidden="true" style={{ backgroundColor: option.color }} />{option.name}
        </button>)}
      </div>
    </div>
  </>;
}
