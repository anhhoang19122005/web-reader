import assert from "node:assert/strict";
import { momentKind } from "./src/lib/cultivation-moments.ts";

assert.equal(momentKind("Trên bầu trời, lôi kiếp cuồn cuộn giáng xuống."), "thunder");
assert.equal(momentKind("Hắn rốt cục ĐỘT PHÁ Kim Đan kỳ!"), "breakthrough");
assert.equal(momentKind("Một đạo kiếm khí xé rách không gian."), "sword");
assert.equal(momentKind("Hỏa diễm màu xanh bao phủ toàn thân."), "flame");
assert.equal(momentKind("Hắn phun ra một ngụm máu tươi."), "blood");
// Priority: tribulation wins over the breakthrough it causes.
assert.equal(momentKind("Đột phá Nguyên Anh, thiên kiếp lập tức hạ xuống."), "thunder");
// Decomposed (NFD) text from some EPUBs still matches.
assert.equal(momentKind("Kiếm quang lóe lên.".normalize("NFD")), "sword");
// Whole words only: "kiếm khí" must not match inside a longer word, and plain prose stays calm.
assert.equal(momentKind("Hắn ngồi xuống uống trà, nhìn mưa ngoài cửa sổ."), null);
// Merely naming a realm is not a breakthrough.
assert.equal(momentKind("Lão này chỉ có tu vi Hoá Thần trung kỳ, tất cả đều là Kết Đan tu sĩ."), null);
assert.equal(momentKind("tìm kiếm khíaaa"), null);
console.log("Cultivation moment checks passed");
