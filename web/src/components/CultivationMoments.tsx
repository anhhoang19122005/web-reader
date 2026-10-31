"use client";

import { useEffect, useState, type CSSProperties, type RefObject } from "react";
import type { MomentKind } from "../lib/cultivation-moments";
import { useReadingPreferences } from "../lib/reading-preferences";

const cooldownMs = 12000; // battle chapters can mark 20+ paragraphs
const spread = (count: number) => Array.from({ length: count }, (_, i) => ({ x: (i * 37 + 11) % 100, d: (i * 0.13) % 0.9, drift: ((i * 29) % 60) - 30 }));

// Plays a short cultivation-style effect when a marked paragraph reaches the middle of the screen.
export function CultivationMoments({ containerRef, text }: { containerRef: RefObject<HTMLElement | null>; text: string }) {
  const enabled = useReadingPreferences((s) => s.moments);
  const [active, setActive] = useState<{ id: number; kind: MomentKind } | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!enabled || !container) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    let last = 0;
    let sequence = 0;
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        const element = entry.target as HTMLElement;
        if (!entry.isIntersecting) continue;
        observer.unobserve(element);
        element.dataset.momentSeen = "true";
        if (reduced.matches || document.hidden || Date.now() - last < cooldownMs) continue;
        last = Date.now();
        setActive({ id: ++sequence, kind: element.dataset.moment as MomentKind });
      }
    }, { rootMargin: "-35% 0px -35% 0px" });
    // React reuses paragraph spans across chapters, so clear marks from the previous text.
    for (const element of container.querySelectorAll<HTMLElement>("[data-moment-seen]")) delete element.dataset.momentSeen;
    for (const element of container.querySelectorAll<HTMLElement>("[data-moment]")) observer.observe(element);
    return () => observer.disconnect();
  }, [enabled, containerRef, text]);

  if (!enabled || !active) return null;
  const { kind } = active;
  return <div key={active.id} className={`moment-layer moment-${kind}`} aria-hidden="true" onAnimationEnd={(event) => { if (event.target === event.currentTarget) setActive(null); }}>
    {kind === "thunder" && <svg className="moment-bolt" viewBox="0 0 100 220" preserveAspectRatio="none"><polyline points="60,0 42,70 58,78 30,150 48,156 20,220" /></svg>}
    {kind === "breakthrough" && <span className="moment-ring" />}
    {kind === "sword" && [0.05, 0.25, 0.45].map((d, i) => <span key={i} className="moment-streak" style={{ "--d": `${d}s`, "--y": `${30 + i * 18}%` } as CSSProperties} />)}
    {(kind === "breakthrough" || kind === "flame") && spread(16).map((p, i) => <span key={i} className="moment-mote" style={{ "--x": `${p.x}%`, "--d": `${p.d}s`, "--drift": `${p.drift}px` } as CSSProperties} />)}
  </div>;
}
