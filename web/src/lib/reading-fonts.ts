// Every font here has a real Vietnamese subset (checked against Google Fonts metadata), so
// stacked diacritics never fall back to another typeface. The `--font-*` variables come from
// lib/font-faces/*, which load-reading-font.ts imports only when that font is selected.
// Keep the ids in sync with the allow-list in go-api/preferences.go.
export const readingFonts = [
  { id: "sans", label: "Sans · Arial", family: "Arial, Helvetica, sans-serif" },
  { id: "serif", label: "Serif · Source Serif 4", family: "var(--font-reader-serif), Georgia, serif" },
  { id: "literata", label: "Serif · Literata", family: "var(--font-literata, Georgia), Georgia, serif" },
  { id: "merriweather", label: "Serif · Merriweather", family: "var(--font-merriweather, Georgia), Georgia, serif" },
  { id: "lora", label: "Serif · Lora", family: "var(--font-lora, Georgia), Georgia, serif" },
  { id: "noto-serif", label: "Serif · Noto Serif", family: "var(--font-noto-serif, Georgia), Georgia, serif" },
  { id: "crimson-pro", label: "Serif · Crimson Pro", family: "var(--font-crimson-pro, Georgia), Georgia, serif" },
  { id: "be-vietnam-pro", label: "Sans · Be Vietnam Pro", family: "var(--font-be-vietnam-pro, Arial), Arial, Helvetica, sans-serif" },
] as const;

export type ReadingFont = (typeof readingFonts)[number]["id"];

export function isReadingFont(value: unknown): value is ReadingFont {
  return readingFonts.some((font) => font.id === value);
}

export function readingFontFamily(id: ReadingFont): string {
  return (readingFonts.find((font) => font.id === id) ?? readingFonts[0]).family;
}
