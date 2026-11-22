import assert from "node:assert/strict";
import { resumePoint, audioPosition, revealStop } from "./src/lib/tts-progress.ts";

const chunks = [
  { chunkIndex: 0, startCharacter: 0, endCharacter: 100, text: "first" },
  { chunkIndex: 1, startCharacter: 110, endCharacter: 210, text: "second" },
];
assert.deepEqual(resumePoint(chunks, 160), { index: 1, fraction: 0.5 });
assert.deepEqual(resumePoint(chunks, 100), { index: 1, fraction: 0 });
assert.deepEqual(resumePoint(chunks, 999), { index: 1, fraction: 1 });
assert.deepEqual(resumePoint([], 0), { index: 0, fraction: 0 });
assert.equal(audioPosition(chunks[1], 5, 10), 160);
assert.equal(audioPosition(chunks[1], 12, 10), 210);
assert.equal(audioPosition(chunks[1], -1, 10), 110);
assert.equal(audioPosition(chunks[1], 5, Infinity), null);
assert.equal(audioPosition(chunks[1], 5, 0), null);
// With chapter text, time spent pausing at punctuation holds the position at the punctuation mark.
const spoken = "Ab. Cd";
const whole = { chunkIndex: 0, startCharacter: 0, endCharacter: spoken.length, text: spoken };
assert.equal(audioPosition(whole, 0, 14, spoken), 0);
assert.equal(audioPosition(whole, 6, 14, spoken), 2);
assert.equal(audioPosition(whole, 10, 14, spoken), 2);
assert.equal(audioPosition(whole, 12, 14, spoken), 4);
assert.equal(audioPosition(whole, 14, 14, spoken), spoken.length);
// Marks pin a part's first letter to its start time, whatever whitespace the chapter has between parts.
const marked = "Ab.\n\nCd ef.";
const markedChunk = { chunkIndex: 0, startCharacter: 0, endCharacter: marked.length, text: "Ab. Cd ef." };
const marks = [{ ms: 0, nonSpace: 0 }, { ms: 3000, nonSpace: 3 }];
assert.equal(audioPosition(markedChunk, 0, 6, marked, marks), 0);
assert.equal(audioPosition(markedChunk, 3, 6, marked, marks), 5);
assert.ok(audioPosition(markedChunk, 2.9, 6, marked, marks) < 5);
assert.ok(audioPosition(markedChunk, 4.5, 6, marked, marks) > 5);
assert.equal(audioPosition(markedChunk, 6, 6, marked, marks), marked.length);
// Running text: a word ends at whitespace, a sentence at punctuation followed by whitespace.
const line = "Hắn bước đi. Gió nổi lên! Trời tối";
assert.equal(revealStop(line, 2, line.length, false), 3);
assert.equal(revealStop(line, 2, line.length, true), 12);
assert.equal(revealStop(line, 13, line.length, true), 25);
assert.equal(revealStop(line, 26, line.length, true), line.length);
assert.equal(revealStop(line, 2, 3, false), 3);
console.log("TTS progress checks passed");
