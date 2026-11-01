import assert from "node:assert/strict";
import { weatherMatches } from "./src/lib/weather-words.ts";

const found = (text) => weatherMatches(text).map(({ start, end, kind }) => `${kind}:${text.slice(start, end)}`);

assert.deepEqual(found("Cơn mưa phùn rơi, gió lạnh thổi qua."), ["rain:mưa", "wind:gió"]);
// A capitalised sentence start is skipped on purpose (it could be a name); lowercase words still count.
assert.deepEqual(found("Bão tuyết phủ kín núi."), ["snow:tuyết"]);
assert.deepEqual(found("Trời nổi bão tuyết, tuyết rơi dày."), ["snow:bão tuyết", "snow:tuyết"]);
assert.deepEqual(found("Sương mù giăng kín, mặt trời lên."), ["sun:mặt trời"]);
assert.deepEqual(found("màn sương mù và mặt trời đỏ"), ["fog:sương mù", "sun:mặt trời"]);
// Longest match wins.
assert.deepEqual(found("một trận bão cát và bão lớn"), ["wind:bão cát", "storm:bão"]);
assert.deepEqual(found("tia sét và sấm chớp"), ["storm:tia sét", "storm:sấm chớp"]);
// Everyday words and longer words must not trigger.
assert.deepEqual(found("hắn chớp mắt, tuyệt vời, đất sét"), []);
assert.deepEqual(found("mưaaa gióa"), []);
// NFD text is left alone so offsets stay identical to the stored text.
assert.deepEqual(weatherMatches("mưa rơi".normalize("NFD")), []);
// Matches index the original string exactly.
const text = "Trời mưa to, gió nổi.";
for (const { start, end } of weatherMatches(text)) assert.ok(["mưa", "gió"].includes(text.slice(start, end)));
console.log("Weather word checks passed");
