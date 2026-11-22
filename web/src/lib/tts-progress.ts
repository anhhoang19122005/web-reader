import type { TtsChunk, TtsMark } from "./api";

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

// Spreads `fraction` of the time over text[start, end), longer at punctuation pauses.
function pacedPosition(text: string, start: number, end: number, fraction: number) {
  const span = text.slice(start, end);
  let total = 0;
  for (const char of span) total += char.length + pauseWeight(char);
  let target = fraction * total, index = 0;
  for (const char of span) {
    target -= char.length + pauseWeight(char);
    if (target < 0) break;
    index += char.length;
  }
  return start + index;
}

// Where text[start, end) resumes after skipping `count` non-whitespace UTF-16 units (and the whitespace after them).
function nonSpaceOffset(text: string, start: number, end: number, count: number) {
  let index = start;
  for (; index < end && (count > 0 || /\s/.test(text[index])); index++) if (!/\s/.test(text[index])) count--;
  return index;
}

export function audioPosition(chunk: TtsChunk, currentTime: number, duration: number, chapterText?: string, marks: TtsMark[] = []) {
  if (!Number.isFinite(duration) || duration <= 0 || !Number.isFinite(currentTime)) return null;
  const time = Math.max(0, Math.min(duration, currentTime)) * 1000;
  if (chapterText === undefined) return chunk.startCharacter + Math.floor(time / (duration * 1000) * (chunk.endCharacter - chunk.startCharacter));
  // Marks (VieNeu) pin each part's start exactly; only the time between two marks is estimated.
  const next = marks.findIndex((mark) => mark.ms > time);
  const previous = next < 0 ? marks.length - 1 : next - 1;
  const from = previous < 0 ? chunk.startCharacter : nonSpaceOffset(chapterText, chunk.startCharacter, chunk.endCharacter, marks[previous].nonSpace);
  const to = next < 0 ? chunk.endCharacter : nonSpaceOffset(chapterText, chunk.startCharacter, chunk.endCharacter, marks[next].nonSpace);
  const startMs = previous < 0 ? 0 : marks[previous].ms;
  const endMs = next < 0 ? duration * 1000 : marks[next].ms;
  return pacedPosition(chapterText, from, to, (time - startMs) / Math.max(1, endMs - startMs));
}
