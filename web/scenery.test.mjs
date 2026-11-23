// Landscape themes show the photo with nothing over it (no scrim, no panels), so text readability rests entirely on
// the text itself: light solid colours plus a dark halo around every glyph. This checks what can be checked:
// every photo exists at Full HD or better, and every photo theme gets the halo on body text with light colours.
// The halo is what keeps text readable over bright areas; there is no scrim, so no contrast ratio is guaranteed there.
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const css = readFileSync(new URL("./src/app/globals.css", import.meta.url), "utf8");
const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const lin = (v) => { const c = v / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const lum = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);

const themes = [];
for (const [, id, body] of css.matchAll(/:root\[data-theme="([a-z]+)"\]\s*\{([^}]*)\}/g)) {
  const token = (name) => body.match(new RegExp(`${name}:\\s*([^;]+);`))?.[1].trim();
  const photo = token("--photo")?.match(/url\("([^"]+)"\)/)?.[1];
  if (!photo) continue;
  themes.push(id);
  const file = fileURLToPath(new URL(`./public${photo}`, import.meta.url));
  assert.ok(existsSync(file), `${id}: ${photo} is missing`);
  const meta = await sharp(file).metadata();
  assert.ok(meta.width >= 1920 && meta.height >= 1080, `${id}: photo is ${meta.width}x${meta.height}, below Full HD`);
  assert.ok(existsSync(fileURLToPath(new URL(`./public/scenery/thumbs/${id}.webp`, import.meta.url))), `${id}: swatch thumbnail missing`);
  // The halo only works for light text: the colours that sit on the photo must stay near-white.
  for (const name of ["--foreground", "--muted", "--accent"]) {
    assert.ok(lum(hex(token(name))) >= 0.6, `${id}: ${name} ${token(name)} is too dark to read on a photo with a dark halo`);
  }
}
assert.ok(themes.length >= 6, `expected the six landscape themes, found ${themes.length}`);

// Every photo theme must be in the shared selector that removes the covers and adds the halo.
const shared = css.match(/:root:is\(([^)]*)\) body \{ text-shadow:var\(--text-halo\); \}/);
assert.ok(shared, "the body text halo rule for landscape themes is missing");
for (const id of themes) assert.ok(shared[1].includes(`[data-theme="${id}"]`), `${id}: not in the shared landscape rules, its text has no halo`);
assert.ok(/--text-halo:0 0 1px rgb\(0 0 0 \/ \.95\)/.test(css), "the text halo must stay tight and dark");
console.log(`scenery ok: ${themes.join(", ")}`);
