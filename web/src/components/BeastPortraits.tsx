import type { CSSProperties } from "react";
import type { Scene } from "../lib/reading-preferences";

// Public-domain artwork (see public/beasts/SOURCES.md) lit for dark pages. Murals keep their pigments and are hue-shifted to
// the scene colour; woodcuts are line masks filled with it. `size` caps the width, `ratio` is the image's width / height.
type Art = { ratio: number; size: string; look?: string; mask?: boolean };
const wide = "min(54vw,780px)";
const tall = "min(32vw,480px)";
const art: Partial<Record<Scene, Art>> = {
  thanhlong: { ratio: 1000 / 607, size: wide, look: "hue-rotate(135deg) saturate(1.15)" },
  bachho: { ratio: 1000 / 547, size: wide, look: "saturate(.3) brightness(1.2)" },
  chutuoc: { ratio: 806 / 1000, size: tall, look: "hue-rotate(-16deg) saturate(1.7)" },
  huyenvu: { ratio: 1000 / 660, size: wide, look: "hue-rotate(180deg) saturate(1.2)" },
  hondon: { ratio: 770 / 680, size: "min(38vw,520px)", mask: true },
  cungky: { ratio: 600 / 768, size: tall, mask: true },
  daongot: { ratio: 560 / 796, size: tall, mask: true },
  thaothiet: { ratio: 660 / 490, size: "min(34vw,480px)" },
};

export function BeastPortrait({ kind }: { kind: Scene }) {
  const beast = art[kind];
  if (!beast) return null;
  const src = `/beasts/${kind}.webp`;
  const style = { "--ratio": beast.ratio, "--size": beast.size, "--look": beast.look ?? "brightness(1)" } as CSSProperties;
  return <div className="scene-beast" style={style} aria-hidden="true">
    {beast.mask
      ? <div className="beast-art beast-mask" style={{ maskImage: `url(${src})`, WebkitMaskImage: `url(${src})` }} />
      // eslint-disable-next-line @next/next/no-img-element
      : <img className="beast-art" src={src} alt="" decoding="async" />}
  </div>;
}
