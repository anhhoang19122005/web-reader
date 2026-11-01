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
  { id: "thanhlong", name: "Thanh Long", color: "#5fe0c0" },
  { id: "bachho", name: "Bạch Hổ", color: "#d8c27a" },
  { id: "chutuoc", name: "Chu Tước", color: "#ff7a45" },
  { id: "huyenvu", name: "Huyền Vũ", color: "#7db4ff" },
  { id: "hondon", name: "Hỗn Độn", color: "#c39bff" },
  { id: "cungky", name: "Cùng Kỳ", color: "#ffd34d" },
  { id: "daongot", name: "Đào Ngột", color: "#cdbb6e" },
  { id: "thaothiet", name: "Thao Thiết", color: "#43c6a0" },
] as const;
export type ReadingTheme = typeof readingThemes[number]["id"];

export const sceneOptions = [
  { id: "off", name: "Tắt", group: "" },
  { id: "tutien", name: "Tu tiên · linh khí", group: "Thể loại truyện" },
  { id: "tienhiep", name: "Tiên hiệp · mây núi", group: "Thể loại truyện" },
  { id: "huyenhuyen", name: "Huyền huyễn · tinh tú", group: "Thể loại truyện" },
  { id: "thanhlong", name: "Thanh Long · rồng xanh", group: "Tứ tượng thần thú" },
  { id: "bachho", name: "Bạch Hổ · hổ trắng", group: "Tứ tượng thần thú" },
  { id: "chutuoc", name: "Chu Tước · phượng lửa", group: "Tứ tượng thần thú" },
  { id: "huyenvu", name: "Huyền Vũ · quy xà", group: "Tứ tượng thần thú" },
  { id: "hondon", name: "Hỗn Độn · hư không", group: "Hung thú" },
  { id: "cungky", name: "Cùng Kỳ · bão sét", group: "Hung thú" },
  { id: "daongot", name: "Đào Ngột · tro tàn", group: "Hung thú" },
  { id: "thaothiet", name: "Thao Thiết · đồng cổ", group: "Hung thú" },
] as const;
export const sceneGroups = ["Thể loại truyện", "Tứ tượng thần thú", "Hung thú"] as const;
export type Scene = typeof sceneOptions[number]["id"];

export const followOptions = [
  { id: "word", name: "Từng chữ" },
  { id: "sentence", name: "Từng câu" },
  { id: "chunk", name: "Cả đoạn sáng đều" },
  { id: "off", name: "Tắt" },
] as const;
export type Follow = typeof followOptions[number]["id"];

export const followFxOptions = [
  { id: "none", name: "Không" },
  { id: "fade", name: "Hiện mờ dần" },
  { id: "glow", name: "Phát sáng" },
  { id: "rise", name: "Nổi lên" },
  { id: "wave", name: "Sóng chữ" },
  { id: "ink", name: "Mực loang" },
] as const;
export type FollowFx = typeof followFxOptions[number]["id"];

export type ReadingPreferences = {
  theme: ReadingTheme; font: "sans" | "serif"; fontSize: number; lineHeight: number;
  columnWidth: 60 | 68 | 75; leaves: boolean; moments: boolean; weather: boolean; scene: Scene; follow: Follow; followLead: number; followFx: FollowFx; sound: AmbientSound; ambientVolume: number;
};
export const preferenceKeys = ["theme", "font", "fontSize", "lineHeight", "columnWidth", "leaves", "moments", "weather", "scene", "follow", "followLead", "followFx", "sound", "ambientVolume"] as const;
export const defaultPreferences: ReadingPreferences = {
  theme: "sepia", font: "sans", fontSize: 20, lineHeight: 1.8, columnWidth: 68,
  leaves: true, moments: true, weather: true, scene: "off", follow: "word", followLead: 0, followFx: "fade", sound: "brown", ambientVolume: 0.1,
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
  if (typeof value.moments === "boolean") result.moments = value.moments;
  if (typeof value.weather === "boolean") result.weather = value.weather;
  if (sceneOptions.some((scene) => scene.id === value.scene)) result.scene = value.scene as Scene;
  if (followOptions.some((option) => option.id === value.follow)) result.follow = value.follow as Follow;
  if (followFxOptions.some((option) => option.id === value.followFx)) result.followFx = value.followFx as FollowFx;
  if (typeof value.followLead === "number" && value.followLead >= -1 && value.followLead <= 1 && Math.abs(value.followLead * 10 - Math.round(value.followLead * 10)) < 1e-8) result.followLead = value.followLead;
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
