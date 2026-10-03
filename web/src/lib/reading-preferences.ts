import { create } from "zustand";
import { persist } from "zustand/middleware";
import { isAmbientSound, type AmbientSound } from "./ambient-sounds";

export const readingThemes = [
  { id: "light", name: "Sáng", color: "#f5f7f3" },
  { id: "sepia", name: "Giấy", color: "#f4efe7" },
  { id: "dark", name: "Tối", color: "#151d18" },
  { id: "forest", name: "Rừng", color: "#23352a" },
  { id: "ocean", name: "Biển", color: "#d5e7ed" },
  { id: "sakura", name: "Anh đào", color: "#f1d8e2" },
  { id: "sunset", name: "Hoàng hôn", color: "#593e43" },
] as const;
export type ReadingTheme = typeof readingThemes[number]["id"];

export type ReadingPreferences = {
  theme: ReadingTheme; font: "sans" | "serif"; fontSize: number; lineHeight: number;
  columnWidth: 60 | 68 | 75; leaves: boolean; sound: AmbientSound; ambientVolume: number;
};
export const preferenceKeys = ["theme", "font", "fontSize", "lineHeight", "columnWidth", "leaves", "sound", "ambientVolume"] as const;
export const defaultPreferences: ReadingPreferences = {
  theme: "sepia", font: "sans", fontSize: 20, lineHeight: 1.8, columnWidth: 68,
  leaves: true, sound: "brown", ambientVolume: 0.1,
};

export function validPreferences(saved: unknown): Partial<ReadingPreferences> {
  if (!saved || typeof saved !== "object") return {};
  const value = saved as Record<string, unknown>;
  const result: Partial<ReadingPreferences> = {};
  if (readingThemes.some((theme) => theme.id === value.theme)) result.theme = value.theme as ReadingTheme;
  if (value.font === "sans" || value.font === "serif") result.font = value.font;
  if (typeof value.fontSize === "number" && Number.isInteger(value.fontSize) && value.fontSize >= 16 && value.fontSize <= 28) result.fontSize = value.fontSize;
  if (typeof value.lineHeight === "number" && value.lineHeight >= 1.5 && value.lineHeight <= 2.2 && Math.abs(value.lineHeight * 10 - Math.round(value.lineHeight * 10)) < 1e-8) result.lineHeight = value.lineHeight;
  if (value.columnWidth === 60 || value.columnWidth === 68 || value.columnWidth === 75) result.columnWidth = value.columnWidth;
  if (typeof value.leaves === "boolean") result.leaves = value.leaves;
  if (isAmbientSound(value.sound)) result.sound = value.sound;
  if (typeof value.ambientVolume === "number" && Number.isFinite(value.ambientVolume)) result.ambientVolume = Math.max(0, Math.min(0.3, value.ambientVolume));
  return result;
}

export const useReadingPreferences = create(persist(() => ({
  ...defaultPreferences,
  pending: {} as Partial<ReadingPreferences>,
  ready: false,
  syncStatus: "loading" as "loading" | "saved" | "pending" | "offline",
}), {
  name: "gac-sach-preferences", skipHydration: true,
  partialize: (state) => ({ ...Object.fromEntries(preferenceKeys.map((key) => [key, state[key]])), pending: state.pending }),
  merge: (saved, defaults) => {
    const value = saved as Record<string, unknown> | null;
    const preferences = validPreferences(saved);
    if (preferences.fontSize === undefined && value?.textStyle) {
      preferences.fontSize = ({ compact: 18, comfortable: 20, large: 24 } as Record<string, number>)[String(value.textStyle)] ?? 20;
    }
    return { ...defaults, ...preferences, pending: validPreferences(value?.pending) };
  },
}));

// Session-only: reload is always silent and exits focus mode.
export const useAmbientSession = create(() => ({ enabled: false }));
export const useReaderSession = create(() => ({ focus: false }));
