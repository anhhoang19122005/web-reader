import assert from "node:assert/strict";
import { readingFonts, isReadingFont, readingFontFamily } from "./src/lib/reading-fonts.ts";
import { typographyPresets, matchingPreset } from "./src/lib/reading-presets.ts";
import { readFileSync } from "node:fs";

// Every font is selectable, unique, falls back to a generic family, and accepts only known ids.
const ids = readingFonts.map((font) => font.id);
assert.equal(new Set(ids).size, ids.length, "font ids must be unique");
assert.deepEqual(ids, ["sans", "serif", "literata", "merriweather", "lora", "noto-serif", "crimson-pro", "be-vietnam-pro"]);
for (const font of readingFonts) {
  assert.ok(/(serif|sans-serif)$/.test(font.family), `${font.id} needs a generic fallback`);
  assert.equal(readingFontFamily(font.id), font.family);
  assert.ok(isReadingFont(font.id));
}
assert.ok(!isReadingFont("comic-sans") && !isReadingFont(undefined) && !isReadingFont(""));
// The default must stay Arial: the reader typography test and existing users depend on it.
assert.ok(readingFontFamily("sans").startsWith("Arial"));

// Presets stay inside the ranges the settings UI and the API accept, and use real fonts.
assert.equal(typographyPresets.length, 4);
for (const preset of typographyPresets) {
  assert.ok(isReadingFont(preset.font), `${preset.id}: unknown font`);
  assert.ok(Number.isInteger(preset.fontSize) && preset.fontSize >= 16 && preset.fontSize <= 28, `${preset.id}: font size`);
  assert.ok(preset.lineHeight >= 1.5 && preset.lineHeight <= 2.2 && Math.abs(preset.lineHeight * 10 - Math.round(preset.lineHeight * 10)) < 1e-8, `${preset.id}: line height`);
  assert.ok([60, 68, 75].includes(preset.columnWidth), `${preset.id}: column width`);
  assert.equal(matchingPreset(preset), preset.id);
}
assert.equal(matchingPreset({ font: "sans", fontSize: 20, lineHeight: 1.8, columnWidth: 68 }), null);

// Web fonts live in lib/font-faces/<id>.ts, one module each, so their CSS is only sent once selected.
// Each must declare the CSS variable the stack uses and load the Vietnamese subset (otherwise diacritics fall back).
for (const font of readingFonts) {
  const variable = font.family.match(/var\((--[a-z-]+)/)?.[1];
  if (!variable || variable === "--font-reader-serif") continue;
  const source = readFileSync(new URL(`./src/lib/font-faces/${font.id}.ts`, import.meta.url), "utf8");
  assert.ok(source.includes(`variable: "${variable}"`), `${font.id}: ${variable} is not declared in font-faces/${font.id}.ts`);
  assert.ok(source.includes('"vietnamese"'), `${font.id}: missing vietnamese subset`);
  assert.ok(source.includes("preload: false"), `${font.id}: must not be preloaded`);
  // var() needs a fallback, or an undefined variable invalidates the whole font-family declaration.
  assert.ok(font.family.includes(`var(${variable},`), `${font.id}: var() needs a fallback`);
}
// The layout must not declare them again: that made every page download all the fonts.
const layout = readFileSync(new URL("./src/app/layout.tsx", import.meta.url), "utf8");
assert.ok(!layout.includes("next/font/google"), "layout.tsx must not load the reading fonts globally");
// Every web font has a loader.
const loader = readFileSync(new URL("./src/lib/load-reading-font.ts", import.meta.url), "utf8");
for (const font of readingFonts) if (font.family.includes("var(--font-") && font.id !== "serif") assert.ok(loader.includes(`font-faces/${font.id}"`), `${font.id}: no loader`);
console.log("reading fonts ok");
