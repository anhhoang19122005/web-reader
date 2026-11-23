import type { ReadingFont } from "./reading-fonts";

// One-tap typography presets. They only touch font, size, line height and column width;
// the colour theme stays whatever the reader picked.
export type TypographyPreset = {
  id: string; name: string; hint: string;
  font: ReadingFont; fontSize: number; lineHeight: number; columnWidth: 60 | 68 | 75;
};

export const typographyPresets: readonly TypographyPreset[] = [
  { id: "long-read", name: "Đọc dài", hint: "Literata · 20px · giãn 1.8 · rộng 68", font: "literata", fontSize: 20, lineHeight: 1.8, columnWidth: 68 },
  { id: "phone", name: "Điện thoại", hint: "Merriweather · 18px · giãn 1.7 · rộng 60", font: "merriweather", fontSize: 18, lineHeight: 1.7, columnWidth: 60 },
  { id: "paper", name: "Sách giấy", hint: "Crimson Pro · 23px · giãn 1.7 · rộng 68", font: "crimson-pro", fontSize: 23, lineHeight: 1.7, columnWidth: 68 },
  { id: "modern", name: "Hiện đại", hint: "Be Vietnam Pro · 19px · giãn 1.8 · rộng 68", font: "be-vietnam-pro", fontSize: 19, lineHeight: 1.8, columnWidth: 68 },
];

export function matchingPreset(current: { font: string; fontSize: number; lineHeight: number; columnWidth: number }): string | null {
  const found = typographyPresets.find((preset) => preset.font === current.font && preset.fontSize === current.fontSize
    && preset.lineHeight === current.lineHeight && preset.columnWidth === current.columnWidth);
  return found?.id ?? null;
}
