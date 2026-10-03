export const ambientSounds = [
  { id: "brown", label: "Nhiễu nâu · trầm êm", group: "Âm đều" },
  { id: "white", label: "Nhiễu trắng", group: "Âm đều" },
  { id: "pink", label: "Nhiễu hồng", group: "Âm đều" },
  { id: "fan", label: "Quạt đều", group: "Âm đều" },
  { id: "rain", label: "Mưa nhẹ · mô phỏng", group: "Thiên nhiên mô phỏng" },
  { id: "wind", label: "Gió nhẹ · mô phỏng", group: "Thiên nhiên mô phỏng" },
  { id: "waves", label: "Sóng biển · mô phỏng", group: "Thiên nhiên mô phỏng" },
  { id: "stream", label: "Suối chảy · mô phỏng", group: "Thiên nhiên mô phỏng" },
] as const;

export type AmbientSound = typeof ambientSounds[number]["id"];
export function isAmbientSound(value: unknown): value is AmbientSound {
  return ambientSounds.some((sound) => sound.id === value);
}
