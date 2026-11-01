"use client";

import { useEffect, useState, type CSSProperties, type RefObject } from "react";
import type { MomentKind } from "../lib/cultivation-moments";
import { useReadingPreferences } from "../lib/reading-preferences";
import { scatter } from "../lib/scatter";
import type { WeatherKind } from "../lib/weather-words";

const cooldownMs = 12000; // battle chapters can mark 20+ paragraphs
const spread = (count: number) => Array.from({ length: count }, (_, i) => ({ x: (i * 37 + 11) % 100, d: (i * 0.13) % 0.9, drift: ((i * 29) % 60) - 30 }));
const vars = (values: Record<string, string | number>) => values as CSSProperties;

// Plays a short effect when a paragraph with a dramatic or weather keyword reaches the middle of the screen.
export function CultivationMoments({ containerRef, text }: { containerRef: RefObject<HTMLElement | null>; text: string }) {
  const moments = useReadingPreferences((s) => s.moments);
  const weather = useReadingPreferences((s) => s.weather);
  const [active, setActive] = useState<{ id: number; kind: MomentKind | WeatherKind } | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!(moments || weather) || !container) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    let last = 0;
    let sequence = 0;
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        const element = entry.target as HTMLElement;
        if (!entry.isIntersecting) continue;
        observer.unobserve(element);
        // The running-letter text is cheap and local, so it ignores the overlay cooldown.
        if (weather && element.dataset.weather) element.dataset.wxLive = "true";
        if (moments && element.dataset.moment) element.dataset.momentSeen = "true";
        const kind = (moments && element.dataset.moment) || (weather && element.dataset.weather) || null;
        if (!kind || reduced.matches || document.hidden || Date.now() - last < cooldownMs) continue;
        last = Date.now();
        setActive({ id: ++sequence, kind: kind as MomentKind | WeatherKind });
      }
    }, { rootMargin: "-35% 0px -35% 0px" });
    // React reuses paragraph spans across chapters, so clear marks from the previous text.
    for (const element of container.querySelectorAll<HTMLElement>("[data-moment-seen],[data-wx-live]")) { delete element.dataset.momentSeen; delete element.dataset.wxLive; }
    for (const element of container.querySelectorAll<HTMLElement>("[data-moment],[data-weather]")) observer.observe(element);
    return () => observer.disconnect();
  }, [moments, weather, containerRef, text]);

  if (!active) return null;
  const kind = active.kind === "storm" ? "thunder" : active.kind; // a storm borrows the lightning strike
  return <div key={active.id} className={`moment-layer moment-${kind}`} aria-hidden="true" onAnimationEnd={(event) => { if (event.target === event.currentTarget) setActive(null); }}>
    {kind === "thunder" && <svg className="moment-bolt" viewBox="0 0 100 220" preserveAspectRatio="none"><polyline points="60,0 42,70 58,78 30,150 48,156 20,220" /></svg>}
    {kind === "breakthrough" && <span className="moment-ring" />}
    {kind === "sword" && [0.05, 0.25, 0.45].map((d, i) => <span key={i} className="moment-streak" style={vars({ "--d": `${d}s`, "--y": `${30 + i * 18}%` })} />)}
    {(kind === "breakthrough" || kind === "flame") && spread(16).map((p, i) => <span key={i} className="moment-mote" style={vars({ "--x": `${p.x}%`, "--d": `${p.d}s`, "--drift": `${p.drift}px` })} />)}
    {kind === "rain" && scatter(44, 0.9).map((p, i) => <span key={i} className="moment-drop" style={vars({ "--x": `${p.x}%`, "--d": `${p.d}s`, "--t": `${p.t}s` })} />)}
    {kind === "snow" && scatter(30, 3.2).map((p, i) => <span key={i} className="moment-flake" style={vars({ "--x": `${p.x}%`, "--d": `${p.d}s`, "--t": `${p.t}s`, "--s": p.s, "--drift": `${p.drift}px` })} />)}
    {kind === "wind" && <>
      {scatter(7, 1.1).map((p, i) => <span key={i} className="moment-gust" style={vars({ "--y": `${10 + p.y}%`, "--d": `${p.d}s`, "--t": `${p.t}s` })} />)}
      {scatter(8, 2).map((p, i) => <span key={i} className="moment-leaf" style={vars({ "--y": `${p.y}%`, "--d": `${p.d}s`, "--t": `${p.t}s`, "--s": p.s })} />)}
    </>}
    {kind === "fog" && scatter(3, 4).map((p, i) => <span key={i} className="moment-fogbank" style={vars({ "--y": `${10 + i * 28}%`, "--d": `${p.d}s`, "--t": `${p.t + 1}s` })} />)}
    {kind === "sun" && <span className="moment-sunburst" />}
  </div>;
}
