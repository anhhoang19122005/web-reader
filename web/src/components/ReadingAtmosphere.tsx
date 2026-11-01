"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState, type CSSProperties } from "react";
import { sceneOptions, useAmbientSession, useReadingPreferences, useReaderSession, type Scene } from "../lib/reading-preferences";
import { scatter } from "../lib/scatter";
import { closeAmbient, setAmbientGain, startAmbient, suspendAmbient } from "../lib/ambient-audio";
import { useTtsSession } from "../lib/tts-session";
import { ambientSounds, isAmbientSound } from "../lib/ambient-sounds";

export function ReadingAtmosphere() {
  const path = usePathname();
  const inReader = path.startsWith("/reader/");
  const { theme, leaves, scene, sound, ambientVolume, ready } = useReadingPreferences();
  const enabled = useAmbientSession((s) => s.enabled);
  const speechPlaying = useTtsSession((s) => s.speechPlaying);
  const focus = useReaderSession((s) => s.focus);
  const [leaf, setLeaf] = useState<{ id: number; side: string } | null>(null);

  useEffect(() => {
    if (!ready) return;
    document.documentElement.dataset.theme = theme;
    const colors = { light: "#f5f7f3", sepia: "#f4efe7", dark: "#151d18", forest: "#18251e", ocean: "#edf4f7", sakura: "#faf0f3", sunset: "#292126", thanhlong: "#0e1f1d", bachho: "#f1efe9", chutuoc: "#200f0d", huyenvu: "#0b1220", hondon: "#17121f", cungky: "#14161f", daongot: "#1b1a14", thaothiet: "#1a1512" };
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

  return <div className="atmosphere" aria-hidden="true">{scene !== "off" && !focus && <AtmosphereScene kind={scene} />}{leaves && !focus && leaf && <span key={leaf.id} className={`falling-leaf leaf-${leaf.side}`} onAnimationEnd={() => setLeaf(null)} />}</div>;
}

const vars = (values: Record<string, string | number>) => values as CSSProperties;
const runes = "天道玄靈符陣劍命";

// Genre backdrops: slow, faint particles for cultivation (tu tiên), xianxia (tiên hiệp) and fantasy (huyền huyễn) stories.
function AtmosphereScene({ kind }: { kind: Exclude<Scene, "off"> }) {
  const at = (p: ReturnType<typeof scatter>[number]) => ({ "--x": `${p.x}%`, "--y": `${p.y}%`, "--t": `${p.t}s`, "--d": `${p.d}s`, "--s": p.s, "--drift": `${p.drift}px` });
  return <div className={`scene scene-${kind}`}>
    {kind === "tutien" && <><span className="scene-array" />{scatter(22, 16).map((p, i) => <span key={i} className="scene-qi" style={vars(at(p))} />)}</>}
    {kind === "tienhiep" && <><span className="scene-peaks" />
      {scatter(5, 70).map((p, i) => <span key={`c${i}`} className="scene-cloud" style={vars({ ...at(p), "--y": `${6 + i * 16}%` })} />)}
      {scatter(12, 14).map((p, i) => <span key={`p${i}`} className="scene-petal" style={vars(at(p))} />)}
      <span className="scene-sword" /></>}
    {kind === "huyenhuyen" && <><span className="scene-aurora" /><span className="scene-aurora scene-aurora-b" />
      {scatter(34, 4).map((p, i) => <span key={`s${i}`} className="scene-star" style={vars(at(p))} />)}
      {scatter(8, 22).map((p, i) => <span key={`r${i}`} className="scene-rune" style={vars(at(p))}>{runes[i]}</span>)}</>}
  </div>;
}

export function AtmosphereControls() {
  const { leaves, moments, weather, scene, sound, ambientVolume } = useReadingPreferences();
  const enabled = useAmbientSession((s) => s.enabled);
  const [error, setError] = useState("");
  async function toggle() {
    if (enabled) { useAmbientSession.setState({ enabled: false }); closeAmbient(); return; }
    try {
      setError("");
      if (await startAmbient(sound)) useAmbientSession.setState({ enabled: true });
    } catch { setError("Trình duyệt chưa cho phép phát âm nền. Hãy thử bật lại."); }
  }
  return <fieldset className="ambience-controls"><legend>Không gian đọc</legend>
    <label className="toggle-label"><input type="checkbox" checked={leaves} onChange={(e) => useReadingPreferences.setState({ leaves: e.target.checked })} /> Lá rơi nhẹ</label>
    <label className="toggle-label"><input type="checkbox" checked={moments} onChange={(e) => useReadingPreferences.setState({ moments: e.target.checked })} /> Hiệu ứng ở đoạn gay cấn</label>
    <label className="toggle-label"><input type="checkbox" checked={weather} onChange={(e) => useReadingPreferences.setState({ weather: e.target.checked })} /> Chữ chạy khi gặp từ thời tiết (mưa, gió, tuyết…)</label>
    <label>Nền động <select aria-label="Nền động theo thể loại truyện" value={scene} onChange={(e) => {
      const option = sceneOptions.find((item) => item.id === e.target.value);
      if (option) useReadingPreferences.setState({ scene: option.id });
    }}>{sceneOptions.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
    <button type="button" aria-pressed={enabled} onClick={() => void toggle()}>{enabled ? "Tắt âm nền" : "Bật âm nền"}</button>
    <label>Âm nền <select aria-label="Loại âm nền" value={sound} onChange={(e) => {
      if (isAmbientSound(e.target.value)) useReadingPreferences.setState({ sound: e.target.value });
    }}>{["Âm đều", "Thiên nhiên mô phỏng"].map((group) => <optgroup key={group} label={group}>
      {ambientSounds.filter((item) => item.group === group).map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
    </optgroup>)}</select></label>
    <label>Âm lượng nền <input aria-label="Âm lượng nền" type="range" min="0" max="0.3" step="0.01" value={ambientVolume} onChange={(e) => useReadingPreferences.setState({ ambientVolume: Number(e.target.value) })} /> {Math.round(ambientVolume * 100)}%</label>
    <p className="subtle">Tự hạ âm khi giọng đọc phát. Hiệu ứng lá, nền động, thời tiết và đoạn gay cấn tuân theo cài đặt giảm chuyển động của thiết bị.</p>
    {error && <p role="alert">{error}</p>}
  </fieldset>;
}
