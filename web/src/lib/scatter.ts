// Deterministic pseudo-random placement for decorative particles; negative delays start each one mid-cycle.
export function scatter(count: number, seconds: number) {
  return Array.from({ length: count }, (_, i) => {
    const t = seconds * (0.7 + ((i * 7) % 6) / 10);
    return { x: (i * 37 + 11) % 100, y: (i * 53 + 7) % 90, t, d: -(((i * 13) % 10) / 10) * t, s: 0.6 + ((i * 11) % 7) / 10, drift: ((i * 29) % 60) - 30 };
  });
}
