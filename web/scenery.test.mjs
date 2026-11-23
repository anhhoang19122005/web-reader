// Landscape themes put text over photos, so legibility is checked from the real image pixels, not by eye:
// for every theme that has a --photo, the brightest area of the photo (99.5th percentile), under its --scrim,
// must still give the text colours enough contrast; on the reading panel they must clear it comfortably.
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const css = readFileSync(new URL("./src/app/globals.css", import.meta.url), "utf8");
const SCRIM = [5, 8, 12]; // must match rgb(5 8 12 / var(--scrim)) in globals.css
const PANEL_ALPHA = 0.86; // must match color-mix(in srgb,var(--surface) 86%,transparent)
assert.ok(css.includes("rgb(5 8 12 / var(--scrim))") && css.includes("var(--surface) 86%"), "globals.css scrim/panel constants changed: update this test");

const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const lin = (v) => { const c = v / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const lum = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
const contrast = (a, b) => { const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };
const mix = (top, bottom, alpha) => top.map((v, i) => v * alpha + bottom[i] * (1 - alpha));

let checked = 0;
for (const [, id, body] of css.matchAll(/:root\[data-theme="([a-z]+)"\]\s*\{([^}]*)\}/g)) {
  const token = (name) => body.match(new RegExp(`${name}:\s*([^;]+);`))?.[1].trim();
  const photo = token("--photo")?.match(/url\("([^"]+)"\)/)?.[1];
  if (!photo) continue;
  const file = fileURLToPath(new URL(`./public${photo}`, import.meta.url));
  assert.ok(existsSync(file), `${id}: ${photo} is missing`);
  const meta = await sharp(file).metadata();
  assert.ok(meta.width >= 1920 && meta.height >= 1080, `${id}: photo is ${meta.width}x${meta.height}, below Full HD`);

  const { data } = await sharp(file).resize(480, 270).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const px = []; for (let i = 0; i < data.length; i += 3) px.push([data[i], data[i + 1], data[i + 2]]);
  px.sort((a, b) => lum(a) - lum(b));
  const brightest = px[Math.floor(px.length * 0.995)];
  const scrim = Number(token("--scrim"));
  assert.ok(scrim > 0 && scrim < 0.9, `${id}: --scrim ${scrim} out of range`);
  const underText = mix(SCRIM, brightest, scrim);
  const panel = mix(hex(token("--surface")), underText, PANEL_ALPHA);
  const colour = { foreground: hex(token("--foreground")), muted: hex(token("--muted")), accent: hex(token("--accent")) };

  const report = {};
  for (const [name, c] of Object.entries(colour)) {
    report[name] = [contrast(c, underText), contrast(c, panel)].map((v) => v.toFixed(1)).join(" / ");
    if (name !== "accent") assert.ok(contrast(c, underText) >= 4.5, `${id}: ${name} on the brightest photo area is ${contrast(c, underText).toFixed(2)}:1 (< 4.5)`);
    assert.ok(contrast(c, panel) >= (name === "foreground" ? 7 : 4.5), `${id}: ${name} on the reading panel is ${contrast(c, panel).toFixed(2)}:1`);
  }
  console.log(`${id}: contrast on photo / on panel`, report);
  checked++;
}
assert.ok(checked >= 2, "no photo themes found");
console.log("scenery contrast ok");
