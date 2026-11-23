import type { ReadingFont } from "./reading-fonts";

// Each web font lives in its own module (lib/font-faces) so its @font-face CSS only reaches
// the browser once the reader selects that font. Declaring them all in the layout made every
// page download ~840 KB of fonts nobody was using.
const loaders: Partial<Record<ReadingFont, () => Promise<{ face: { variable: string } }>>> = {
  literata: () => import("./font-faces/literata"),
  merriweather: () => import("./font-faces/merriweather"),
  lora: () => import("./font-faces/lora"),
  "noto-serif": () => import("./font-faces/noto-serif"),
  "crimson-pro": () => import("./font-faces/crimson-pro"),
  "be-vietnam-pro": () => import("./font-faces/be-vietnam-pro"),
};

/** Loads the font's CSS and returns the class that defines its `--font-*` variable (null for system/built-in fonts). */
export async function loadReadingFont(id: ReadingFont): Promise<string | null> {
  const load = loaders[id];
  return load ? (await load()).face.variable : null;
}
