import type { TtsChunk } from "./api";

export function resumePoint(chunks: TtsChunk[], position: number) {
  const found = chunks.findIndex((chunk) => position < chunk.endCharacter);
  const index = found < 0 ? Math.max(0, chunks.length - 1) : found;
  const chunk = chunks[index];
  const fraction = chunk ? Math.max(0, Math.min(1, (position - chunk.startCharacter) / Math.max(1, chunk.endCharacter - chunk.startCharacter))) : 0;
  return { index, fraction };
}

// Running text stops at the end of the current word, or of the current sentence.
export function revealStop(text: string, from: number, limit: number, sentence: boolean) {
  let end = from;
  while (end < limit && !(/\s/.test(text[end] ?? " ") && (!sentence || /[.!?…”"]/.test(text[end - 1] ?? "")))) end++;
  return end;
}

// Extra time, in characters, the voice pauses after punctuation and line breaks.
const pauseWeight = (char: string) => /[.!?…\n]/.test(char) ? 8 : /[,;:—–]/.test(char) ? 4 : 0;

export function audioPosition(chunk: TtsChunk, currentTime: number, duration: number, chapterText?: string) {
  if (!Number.isFinite(duration) || duration <= 0 || !Number.isFinite(currentTime)) return null;
  const fraction = Math.max(0, Math.min(1, currentTime / duration));
  if (chapterText === undefined) return chunk.startCharacter + Math.floor(fraction * (chunk.endCharacter - chunk.startCharacter));
  // shortcut: pauses are estimated from punctuation; provider word timestamps would make this exact.
  const span = chapterText.slice(chunk.startCharacter, chunk.endCharacter);
  let total = 0;
  for (const char of span) total += char.length + pauseWeight(char);
  let target = fraction * total, index = 0;
  for (const char of span) {
    target -= char.length + pauseWeight(char);
    if (target < 0) break;
    index += char.length;
  }
  return chunk.startCharacter + index;
}
