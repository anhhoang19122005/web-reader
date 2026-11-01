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

export function audioPosition(chunk: TtsChunk, currentTime: number, duration: number) {
  if (!Number.isFinite(duration) || duration <= 0 || !Number.isFinite(currentTime)) return null;
  // ponytail: estimate characters by audio time; word timestamps are needed for exact alignment.
  return chunk.startCharacter + Math.floor(Math.max(0, Math.min(1, currentTime / duration)) * (chunk.endCharacter - chunk.startCharacter));
}
