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
// Running text: a word ends at whitespace, a sentence at punctuation followed by whitespace.
const line = "Hắn bước đi. Gió nổi lên! Trời tối";
assert.equal(revealStop(line, 2, line.length, false), 3);
assert.equal(revealStop(line, 2, line.length, true), 12);
assert.equal(revealStop(line, 13, line.length, true), 25);
assert.equal(revealStop(line, 26, line.length, true), line.length);
assert.equal(revealStop(line, 2, 3, false), 3);
console.log("TTS progress checks passed");
