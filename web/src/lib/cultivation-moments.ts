export type MomentKind = "thunder" | "breakthrough" | "sword" | "flame" | "blood";

// Ordered by priority: a heavenly tribulation paragraph often also mentions breakthroughs or blood.
const momentWords: [MomentKind, string[]][] = [
  ["thunder", ["lôi kiếp", "thiên kiếp", "độ kiếp", "lôi đình", "lôi điện", "thiên lôi", "tia sét", "sấm sét", "lôi quang"]],
  // Realm names (Kim Đan, Nguyên Anh, Hóa Thần…) are everyday words in this genre, so only the act of advancing counts.
  ["breakthrough", ["đột phá", "tấn thăng", "tấn giai", "phi thăng", "ngưng anh", "kết anh", "ngưng kết kim đan", "ngưng kết nguyên anh"]],
  ["sword", ["kiếm khí", "kiếm quang", "kiếm ý", "kiếm trận", "kiếm mang", "vạn kiếm"]],
  ["flame", ["hỏa diễm", "hoả diễm", "liệt hỏa", "liệt hoả", "chân hỏa", "chân hoả", "dị hỏa", "dị hoả", "biển lửa", "ngọn lửa"]],
  ["blood", ["phun ra một ngụm máu", "ngụm máu tươi", "máu tươi", "sát khí", "sát ý", "huyết quang", "huyết vụ"]],
];

const patterns = momentWords.map(([kind, words]) => [kind, new RegExp(`(?<!\\p{L})(?:${words.join("|")})(?!\\p{L})`, "u")] as const);

export function momentKind(paragraph: string): MomentKind | null {
  const text = paragraph.normalize("NFC").toLowerCase();
  return patterns.find(([, pattern]) => pattern.test(text))?.[0] ?? null;
}
