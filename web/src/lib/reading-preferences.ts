import { create } from "zustand";
import { persist } from "zustand/middleware";

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

export const useReadingPreferences = create(persist(() => ({
  theme: "sepia" as ReadingTheme,
  textStyle: "comfortable" as "compact" | "comfortable" | "large",
  leaves: true,
  sound: "brown" as "brown" | "rain",
  ambientVolume: 0.1,
}), {
  name: "gac-sach-preferences", skipHydration: true,
  merge: (saved, defaults) => {
    const value = saved as Partial<typeof defaults> | null;
    if (!value || typeof value !== "object") return defaults;
    return {
      theme: readingThemes.some((theme) => theme.id === value.theme) ? value.theme! : defaults.theme,
      textStyle: ["compact", "comfortable", "large"].includes(value.textStyle ?? "") ? value.textStyle! : defaults.textStyle,
      leaves: typeof value.leaves === "boolean" ? value.leaves : defaults.leaves,
      sound: value.sound === "brown" || value.sound === "rain" ? value.sound : defaults.sound,
      ambientVolume: typeof value.ambientVolume === "number" && Number.isFinite(value.ambientVolume) ? Math.max(0, Math.min(0.3, value.ambientVolume)) : defaults.ambientVolume,
    };
  },
}));

// Enabled is session-only: reload is always silent.
export const useAmbientSession = create(() => ({ enabled: false }));
