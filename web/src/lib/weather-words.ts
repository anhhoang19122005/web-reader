export type WeatherKind = "rain" | "snow" | "wind" | "fog" | "sun" | "storm";
export type WeatherMatch = { start: number; end: number; kind: WeatherKind };

// "chớp mắt" (blink) and "đất sét" (clay) are everyday phrases, so lightning only counts in its compound forms.
const weatherWords: [WeatherKind, string[]][] = [
  ["storm", ["sấm sét", "sấm chớp", "tia sét", "tia chớp", "chớp giật", "sấm", "giông tố", "giông", "bão tố", "bão"]],
  ["snow", ["bão tuyết", "tuyết", "sương giá", "băng giá"]],
  ["rain", ["mưa"]],
  ["wind", ["cuồng phong", "lốc xoáy", "bão cát", "gió"]],
  ["fog", ["sương mù", "mây mù", "khói mù", "sương"]],
  ["sun", ["mặt trời", "ánh dương", "bình minh", "hoàng hôn", "nắng"]],
];

const kindOf = new Map(weatherWords.flatMap(([kind, words]) => words.map((word) => [word, kind] as const)));
// Longest first so "sương mù" wins over "sương" and "bão cát" over "bão".
const pattern = new RegExp(`(?<!\\p{L})(?:${[...kindOf.keys()].sort((a, b) => b.length - a.length).join("|")})(?!\\p{L})`, "gu");

// shortcut: lowercase only, so a sentence-initial "Mưa" is missed but names like "Tuyết" never animate; add a sentence-start rule if that matters.
export function weatherMatches(text: string): WeatherMatch[] {
  // Offsets must equal the original text's, which normalisation could change.
  if (text !== text.normalize("NFC")) return [];
  return Array.from(text.matchAll(pattern), (match) => ({ start: match.index, end: match.index + match[0].length, kind: kindOf.get(match[0])! }));
}
