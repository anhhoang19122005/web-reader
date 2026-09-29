"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { apiUrl, generateTts, getTtsChunks, getTtsVoices, type TtsChunk } from "../lib/api";

export function TtsPlayer({ chapterId, onChunkChange, onComplete }: { chapterId: string; onChunkChange: (chunk: TtsChunk | null) => void; onComplete?: () => void }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [chunkIndex, setChunkIndex] = useState(0);
  const [voiceId, setVoiceId] = useState("");
  const [speakingRate, setSpeakingRate] = useState(1);
  const [pitch, setPitch] = useState(0);
  const [volume, setVolume] = useState(1);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [preset, setPreset] = useState("narrator");
  const [error, setError] = useState("");
  const voices = useQuery({ queryKey: ["tts-voices"], queryFn: getTtsVoices, staleTime: 300_000 });
  const chunks = useQuery({ queryKey: ["tts-chunks", chapterId], queryFn: () => getTtsChunks(chapterId) });
  const generate = useMutation({ mutationFn: generateTts });
  const selectedVoice = voiceId || voices.data?.find((voice) => voice.provider === "edge")?.id || voices.data?.[0]?.id || "";

  async function play(index: number) {
    const chunk = chunks.data?.[index];
    if (!chunk || !selectedVoice) return;
    setError("");
    try {
      const response = await generate.mutateAsync({ chapterId, chunkIndex: index, voiceId: selectedVoice, speakingRate, pitch, volume });
      const audio = audioRef.current;
      if (!audio) return;
      setChunkIndex(index);
      onChunkChange(chunk);
      audio.src = apiUrl(response.audioUrl);
      audio.volume = volume;
      audio.playbackRate = playbackRate;
      await audio.play();
    } catch (exception) {
      setError(exception instanceof Error ? exception.message : "Không thể tạo audio.");
    }
  }

  function playNext() {
    const next = chunkIndex + 1;
    if (chunks.data?.[next]) void play(next);
    else { onChunkChange(null); onComplete?.(); }
  }

  function playPrevious() {
    void play(Math.max(0, chunkIndex - 1));
  }

  function applyPreset(value: string) {
    const values: Record<string, [number, number]> = { narrator: [0.95, 0], deep: [0.9, -10], soft: [0.95, 5], fantasy: [0.9, -5], romance: [0.95, 3], mystery: [0.85, -8] };
    const [rate, nextPitch] = values[value] ?? values.narrator;
    setPreset(value);
    setSpeakingRate(rate);
    setPitch(nextPitch);
  }

  if (voices.isLoading || chunks.isLoading) return <div className="rounded-xl border border-current/10 p-4 font-sans text-sm opacity-70">Đang tải giọng đọc…</div>;
  if (voices.isError || chunks.isError || !voices.data?.length || !chunks.data?.length) return <div className="rounded-xl border border-current/10 p-4 font-sans text-sm opacity-70">Chưa có giọng đọc khả dụng.</div>;

  return <div className="rounded-xl border border-current/10 p-4 font-sans text-sm">
    <div className="flex flex-wrap items-center gap-2">
      <button className="rounded-full border border-current/20 px-3 py-2 disabled:opacity-50" disabled={chunkIndex === 0} onClick={playPrevious}>←</button><button className="rounded-full bg-stone-800 px-4 py-2 text-white disabled:opacity-50" disabled={generate.isPending} onClick={() => void play(chunkIndex)}>{generate.isPending ? "Đang tạo…" : "▶ Đọc"}</button><button className="rounded-full border border-current/20 px-3 py-2 disabled:opacity-50" disabled={chunkIndex >= chunks.data.length - 1} onClick={playNext}>→</button>
      <select className="rounded-lg border border-current/20 bg-transparent px-2 py-2" aria-label="Giọng đọc" value={selectedVoice} onChange={(event) => setVoiceId(event.target.value)}>{voices.data.map((voice) => <option key={voice.id} value={voice.id}>{voice.name}</option>)}</select>
      <select className="rounded-lg border border-current/20 bg-transparent px-2 py-2" aria-label="Preset giọng" value={preset} onChange={(event) => applyPreset(event.target.value)}><option value="narrator">Narrator</option><option value="deep">Deep male</option><option value="soft">Soft female</option><option value="fantasy">Fantasy</option><option value="romance">Romance</option><option value="mystery">Mystery</option></select>
      <label className="flex items-center gap-1">Tốc độ <input aria-label="Tốc độ" type="range" min="0.5" max="2" step="0.1" value={speakingRate} onChange={(event) => setSpeakingRate(Number(event.target.value))} /> {speakingRate}x</label>
      <label className="flex items-center gap-1">Cao độ <input aria-label="Cao độ" type="range" min="-20" max="20" step="1" value={pitch} onChange={(event) => setPitch(Number(event.target.value))} /> {pitch}</label>
      <label className="flex items-center gap-1">Âm lượng <input aria-label="Âm lượng" type="range" min="0" max="1" step="0.1" value={volume} onChange={(event) => setVolume(Number(event.target.value))} /> {Math.round(volume * 100)}%</label>
      <label className="flex items-center gap-1">Phát lại <select aria-label="Tốc độ phát lại" className="rounded-lg border border-current/20 bg-transparent px-2 py-1" value={playbackRate} onChange={(event) => { const value = Number(event.target.value); setPlaybackRate(value); if (audioRef.current) audioRef.current.playbackRate = value; }}><option value="0.75">0.75x</option><option value="1">1x</option><option value="1.25">1.25x</option><option value="1.5">1.5x</option></select></label>
    </div>
    {error && <p className="mt-3 text-sm text-red-700" role="alert">{error}</p>}
    {voices.data.length === 1 && voices.data[0].provider === "mock" && <p className="mt-3 text-xs opacity-60">Đang dùng voice demo. Chạy lại start-reader.ps1 để cài Edge-TTS miễn phí.</p>}
    <audio ref={audioRef} className="mt-3 w-full" controls onEnded={playNext} onVolumeChange={(event) => setVolume(event.currentTarget.volume)} />
    <p className="mt-2 opacity-60">Đoạn {chunkIndex + 1}/{chunks.data.length}</p>
  </div>;
}
