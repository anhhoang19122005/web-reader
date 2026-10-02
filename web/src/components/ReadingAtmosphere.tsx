"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { useAmbientSession, useReadingPreferences, useReaderSession } from "../lib/reading-preferences";
import { closeAmbient, setAmbientGain, startAmbient, suspendAmbient } from "../lib/ambient-audio";
import { useTtsSession } from "../lib/tts-session";

export function ReadingAtmosphere() {
  const path = usePathname();
  const inReader = path.startsWith("/reader/");
  const { theme, leaves, sound, ambientVolume, ready } = useReadingPreferences();
  const enabled = useAmbientSession((s) => s.enabled);
  const speechPlaying = useTtsSession((s) => s.speechPlaying);
  const focus = useReaderSession((s) => s.focus);
  const [leaf, setLeaf] = useState<{ id: number; side: string } | null>(null);

  useEffect(() => {
    if (!ready) return;
    document.documentElement.dataset.theme = theme;
    const colors = { light: "#f5f7f3", sepia: "#f4efe7", dark: "#151d18", forest: "#18251e", ocean: "#edf4f7", sakura: "#faf0f3", sunset: "#292126" };
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", colors[theme]);
  }, [theme, ready, path]);
  useEffect(() => {
    if (!inReader || !enabled) { closeAmbient(); if (!inReader) useAmbientSession.setState({ enabled: false }); return; }
    let disposed = false;
    const update = () => {
      if (document.hidden) { suspendAmbient(); return; }
      void startAmbient(sound).then(() => {
        if (!disposed) setAmbientGain(ambientVolume, speechPlaying);
      }).catch(() => useAmbientSession.setState({ enabled: false }));
    };
    update();
    document.addEventListener("visibilitychange", update);
    return () => { disposed = true; document.removeEventListener("visibilitychange", update); };
  }, [inReader, enabled, sound, ambientVolume, speechPlaying]);
  useEffect(() => () => closeAmbient(), []);

  useEffect(() => {
    if (!leaves || focus) return;
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    let timer: ReturnType<typeof setTimeout>;
    let sequence = 0;
    const schedule = () => {
      clearTimeout(timer);
      if (document.hidden || media.matches) { setLeaf(null); return; }
      timer = setTimeout(() => {
        setLeaf({ id: ++sequence, side: Math.random() > 0.5 ? "left" : "right" });
        schedule();
      }, 12000 + Math.random() * 13000);
    };
    schedule();
    document.addEventListener("visibilitychange", schedule);
    media.addEventListener("change", schedule);
    return () => { clearTimeout(timer); document.removeEventListener("visibilitychange", schedule); media.removeEventListener("change", schedule); };
  }, [leaves, focus]);

  return <div className="atmosphere" aria-hidden="true">{leaves && !focus && leaf && <span key={leaf.id} className={`falling-leaf leaf-${leaf.side}`} onAnimationEnd={() => setLeaf(null)} />}</div>;
}

export function AtmosphereControls() {
  const { leaves, sound, ambientVolume } = useReadingPreferences();
  const enabled = useAmbientSession((s) => s.enabled);
  const [error, setError] = useState("");
  async function toggle() {
    if (enabled) { useAmbientSession.setState({ enabled: false }); closeAmbient(); return; }
    try {
      setError("");
      await startAmbient(sound);
      useAmbientSession.setState({ enabled: true });
    } catch { setError("Trình duyệt chưa cho phép phát âm nền. Hãy thử bật lại."); }
  }
  return <fieldset className="ambience-controls"><legend>Không gian đọc</legend>
    <label className="toggle-label"><input type="checkbox" checked={leaves} onChange={(e) => useReadingPreferences.setState({ leaves: e.target.checked })} /> Lá rơi nhẹ</label>
    <button type="button" aria-pressed={enabled} onClick={() => void toggle()}>{enabled ? "Tắt âm nền" : "Bật âm nền"}</button>
    <label>Âm nền <select aria-label="Loại âm nền" value={sound} onChange={(e) => useReadingPreferences.setState({ sound: e.target.value as "brown" | "rain" })}><option value="brown">Nhiễu nâu · trầm êm</option><option value="rain">Mưa nhẹ · mô phỏng</option></select></label>
    <label>Âm lượng nền <input aria-label="Âm lượng nền" type="range" min="0" max="0.3" step="0.01" value={ambientVolume} onChange={(e) => useReadingPreferences.setState({ ambientVolume: Number(e.target.value) })} /> {Math.round(ambientVolume * 100)}%</label>
    <p className="subtle">Tự hạ âm khi giọng đọc phát. Hiệu ứng lá tuân theo cài đặt giảm chuyển động của thiết bị.</p>
    {error && <p role="alert">{error}</p>}
  </fieldset>;
}
