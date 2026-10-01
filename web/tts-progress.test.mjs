import assert from "node:assert/strict";
import { resumePoint, audioPosition } from "./src/lib/tts-progress.ts";

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
console.log("TTS progress checks passed");
