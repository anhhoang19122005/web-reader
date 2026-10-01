import { create } from "zustand";
import { persist } from "zustand/middleware";

export const useReadingPreferences = create(persist(() => ({
  theme: "sepia" as "light" | "sepia" | "dark",
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
      theme: ["light", "sepia", "dark"].includes(value.theme ?? "") ? value.theme! : defaults.theme,
      textStyle: ["compact", "comfortable", "large"].includes(value.textStyle ?? "") ? value.textStyle! : defaults.textStyle,
      leaves: typeof value.leaves === "boolean" ? value.leaves : defaults.leaves,
      sound: value.sound === "brown" || value.sound === "rain" ? value.sound : defaults.sound,
      ambientVolume: typeof value.ambientVolume === "number" && Number.isFinite(value.ambientVolume) ? Math.max(0, Math.min(0.3, value.ambientVolume)) : defaults.ambientVolume,
    };
  },
}));

// Enabled is session-only: reload is always silent.
export const useAmbientSession = create(() => ({ enabled: false }));
