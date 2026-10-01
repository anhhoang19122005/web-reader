"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { apiUrl, generateTts, getTtsChunks, getTtsVoices, type TtsChunk, type TtsGenerateResponse } from "../lib/api";
import { useTtsSession } from "../lib/tts-session";

const providerLabels: Record<string, string> = { edge: "Edge-TTS", saydi: "SaydiVoice", mock: "Demo", local: "Local · Offline" };
const ttsAudioCacheTime = 24 * 60 * 60 * 1000;
type TtsPayload = Parameters<typeof generateTts>[0];
type BufferedAudio = { index: number; settings: string; url: string };
type PendingAudio = { index: number; settings: string; controller: AbortController };

function ttsAudioKey(payload: TtsPayload, chunkText: string, provider: string) {
  return ["tts-audio", payload.chapterId, payload.chunkIndex, chunkText, provider, payload.voiceId, payload.speakingRate, payload.pitch, payload.volume] as const;
}

export function TtsPlayer({ chapterId, onChunkChange, onComplete }: { chapterId: string; onChunkChange: (chunk: TtsChunk | null, info?: { auto: boolean }) => void; onComplete?: () => void }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [chunkIndex, setChunkIndex] = useState(0);
  const { voiceId, speakingRate, pitch, volume, playbackRate, preset, provider, running, autoplayChapterId } = useTtsSession();
  const setVoiceId = (voiceId: string) => useTtsSession.setState({ voiceId });
  const setSpeakingRate = (speakingRate: number) => useTtsSession.setState({ speakingRate });
  const setPitch = (pitch: number) => useTtsSession.setState({ pitch });
  const setVolume = (volume: number) => useTtsSession.setState({ volume });
  const setPlaybackRate = (playbackRate: number) => useTtsSession.setState({ playbackRate });
  const setPreset = (preset: string) => useTtsSession.setState({ preset });
  const setProvider = (provider: string) => useTtsSession.setState({ provider });
  const [error, setError] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const playVersion = useRef(0);
  const settingsVersion = useRef(0);
  const activeIndex = useRef(-1);
  const activeAudioKey = useRef("");
  const bufferedAudio = useRef(new Map<string, BufferedAudio>());
  const pendingAudio = useRef(new Map<string, PendingAudio>());
  const queryClient = useQueryClient();
  const voices = useQuery({ queryKey: ["tts-voices"], queryFn: getTtsVoices, staleTime: 300_000 });
  const chunks = useQuery({ queryKey: ["tts-chunks", chapterId], queryFn: () => getTtsChunks(chapterId) });
  const allVoices = voices.data ?? [];
  const providers = Array.from(new Set(allVoices.map((voice) => voice.provider)));
  const visibleVoices = provider === "all" ? allVoices : allVoices.filter((voice) => voice.provider === provider);
  const selectedVoice = visibleVoices.some((voice) => voice.id === voiceId) ? voiceId : visibleVoices.find((voice) => voice.provider === "local")?.id || visibleVoices.find((voice) => voice.provider === "edge")?.id || visibleVoices[0]?.id || "";
  const selectedVoiceInfo = visibleVoices.find((voice) => voice.id === selectedVoice);
  const isFixedPitchProvider = selectedVoiceInfo?.provider === "saydi" || selectedVoiceInfo?.provider === "local";
  const effectivePitch = isFixedPitchProvider ? 0 : pitch;
  const audioSettings = JSON.stringify([chapterId, selectedVoiceInfo?.provider, selectedVoice, speakingRate, effectivePitch]);

  useEffect(() => {
    const buffered = bufferedAudio.current;
    const pending = pendingAudio.current;
    const playback = playVersion;
    const settings = settingsVersion;
    const audio = audioRef.current;
    return () => {
      playback.current++;
      settings.current++;
      audio?.pause();
      if (!useTtsSession.getState().autoplayChapterId) useTtsSession.setState({ running: false });
      for (const entry of pending.values()) entry.controller.abort();
      pending.clear();
      for (const entry of buffered.values()) URL.revokeObjectURL(entry.url);
      buffered.clear();
    };
  }, []);

  useEffect(() => {
    if (autoplayChapterId !== chapterId || !running) return;
    if (voices.isError || chunks.isError || (voices.data && !voices.data.length) || (chunks.data && !chunks.data.length)) {
      useTtsSession.setState({ running: false, autoplayChapterId: "" });
      return;
    }
    if (!selectedVoice || !chunks.data?.length) return;
    const timer = setTimeout(() => {
      if (useTtsSession.getState().autoplayChapterId !== chapterId) return;
      useTtsSession.setState({ autoplayChapterId: "" });
      void play(0, true);
    }, 0);
    return () => clearTimeout(timer);
    // Playback starts once, after both queries resolve; settings come from the session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chapterId, autoplayChapterId, running, selectedVoice, chunks.data, voices.isError, chunks.isError]);

  function stop() {
    invalidateSetting();
    useTtsSession.setState({ running: false, autoplayChapterId: "" });
    audioRef.current?.pause();
    onChunkChange(null);
  }

  function invalidateSetting() {
    settingsVersion.current++;
    playVersion.current++;
    setIsGenerating(false);
    for (const entry of pendingAudio.current.values()) entry.controller.abort();
    pendingAudio.current.clear();
  }

  function chunkRequest(index: number) {
    const chunk = chunks.data?.[index];
    if (!chunk || !selectedVoiceInfo) return null;
    const payload = { chapterId, chunkIndex: index, voiceId: selectedVoice, speakingRate, pitch: effectivePitch, volume: 1 };
    const queryKey = ttsAudioKey(payload, chunk.text, selectedVoiceInfo.provider);
    return { chunk, payload, queryKey, audioKey: JSON.stringify(queryKey), settings: audioSettings };
  }

  function trimAudioBuffer(index: number, settings: string) {
    for (const [key, entry] of bufferedAudio.current) {
      if (Math.abs(entry.index - index) <= 1 && (entry.settings === settings || key === activeAudioKey.current)) continue;
      URL.revokeObjectURL(entry.url);
      bufferedAudio.current.delete(key);
    }
    for (const [key, entry] of pendingAudio.current) {
      if (Math.abs(entry.index - index) <= 1 && entry.settings === settings) continue;
      entry.controller.abort();
      pendingAudio.current.delete(key);
    }
    while (bufferedAudio.current.size > 3) {
      const key = [...bufferedAudio.current.keys()].find((value) => value !== activeAudioKey.current);
      if (!key) break;
      URL.revokeObjectURL(bufferedAudio.current.get(key)!.url);
      bufferedAudio.current.delete(key);
    }
  }

  function generateChunk(request: NonNullable<ReturnType<typeof chunkRequest>>) {
    return queryClient.fetchQuery({
      queryKey: request.queryKey,
      queryFn: () => generateTts(request.payload),
      staleTime: Infinity,
      gcTime: ttsAudioCacheTime,
      retry: false,
    });
  }

  async function prefetchNext(index: number) {
    const request = chunkRequest(index + 1);
    if (!request) return;
    const version = settingsVersion.current;
    await queryClient.prefetchQuery({
      queryKey: request.queryKey,
      queryFn: () => generateTts(request.payload),
      staleTime: Infinity,
      gcTime: ttsAudioCacheTime,
      retry: false,
    });
    if (version !== settingsVersion.current || index !== activeIndex.current) return;
    const response = queryClient.getQueryData<TtsGenerateResponse>(request.queryKey);
    if (!response || bufferedAudio.current.has(request.audioKey) || pendingAudio.current.has(request.audioKey)) return;

    const controller = new AbortController();
    pendingAudio.current.set(request.audioKey, { index: index + 1, settings: request.settings, controller });
    try {
      const audio = await fetch(apiUrl(response.audioUrl), { signal: controller.signal });
      if (!audio.ok) return;
      const blob = await audio.blob();
      if (controller.signal.aborted || version !== settingsVersion.current || index !== activeIndex.current) return;
      bufferedAudio.current.set(request.audioKey, { index: index + 1, settings: request.settings, url: URL.createObjectURL(blob) });
      trimAudioBuffer(index, request.settings);
    } catch {
      // The next chunk can still be streamed from its URL when playback advances.
    } finally {
      if (pendingAudio.current.get(request.audioKey)?.controller === controller) pendingAudio.current.delete(request.audioKey);
    }
  }

  async function play(index: number, auto = false) {
    const request = chunkRequest(index);
    if (!request) return;
    useTtsSession.setState({ running: true, voiceId: selectedVoice });
    const version = ++playVersion.current;
    const settings = settingsVersion.current;
    setError("");
    setIsGenerating(true);
    try {
      const response = await generateChunk(request);
      if (version !== playVersion.current || settings !== settingsVersion.current) return;
      const audio = audioRef.current;
      if (!audio) return;
      const buffered = bufferedAudio.current.get(request.audioKey);
      if (!buffered) {
        pendingAudio.current.get(request.audioKey)?.controller.abort();
        pendingAudio.current.delete(request.audioKey);
      }
      activeIndex.current = index;
      activeAudioKey.current = buffered ? request.audioKey : "";
      trimAudioBuffer(index, request.settings);
      setChunkIndex(index);
      onChunkChange(request.chunk, { auto });
      audio.src = buffered?.url ?? apiUrl(response.audioUrl);
      audio.volume = volume;
      audio.playbackRate = playbackRate;
      await audio.play();
    } catch (exception) {
      if (version === playVersion.current) {
        useTtsSession.setState({ running: false, autoplayChapterId: "" });
        setError(exception instanceof Error ? exception.message : "Không thể tạo audio.");
      }
    } finally {
      if (version === playVersion.current) setIsGenerating(false);
    }
  }

  function playNext(auto = false) {
    if (auto && !useTtsSession.getState().running) return;
    const next = activeIndex.current + 1;
    if (chunks.data?.[next]) void play(next, true);
    else { onChunkChange(null, { auto: true }); onComplete?.(); }
  }

  function playPrevious() {
    void play(Math.max(0, activeIndex.current - 1));
  }

  function applyPreset(value: string) {
    const values: Record<string, [number, number]> = { narrator: [0.95, 0], deep: [0.9, -10], soft: [0.95, 5], fantasy: [0.9, -5], romance: [0.95, 3], mystery: [0.85, -8], taothao: [0.85, -8] };
    const [rate, nextPitch] = values[value] ?? values.narrator;
    invalidateSetting();
    setPreset(value);
    setSpeakingRate(rate);
    setPitch(nextPitch);
  }

  if (voices.isLoading || chunks.isLoading) return <div className="rounded-xl border border-current/10 p-4 font-sans text-sm opacity-70">Đang tải giọng đọc…</div>;
  if (voices.isError || chunks.isError || !voices.data?.length || !chunks.data?.length) return <div className="rounded-xl border border-current/10 p-4 font-sans text-sm opacity-70">Chưa có giọng đọc khả dụng.</div>;

  return <div className="rounded-xl border border-current/10 p-4 font-sans text-sm">
    <div className="flex flex-wrap items-center gap-2">
      <button className="rounded-full border border-current/20 px-3 py-2 disabled:opacity-50" disabled={chunkIndex === 0} onClick={playPrevious}>←</button><button className="rounded-full bg-stone-800 px-4 py-2 text-white disabled:opacity-50" disabled={isGenerating} onClick={() => void play(chunkIndex)}>{isGenerating ? "Đang tạo…" : "▶ Đọc"}</button><button className="rounded-full border border-current/20 px-3 py-2 disabled:opacity-50" disabled={chunkIndex >= chunks.data.length - 1} onClick={() => playNext()}>→</button>
      <button className="rounded-full border border-current/20 px-3 py-2 disabled:opacity-50" disabled={!running} onClick={stop}>■ Dừng</button>
      <select className="rounded-lg border border-current/20 bg-transparent px-2 py-2" aria-label="Nhà cung cấp giọng đọc" value={provider} onChange={(event) => { invalidateSetting(); setProvider(event.target.value); setVoiceId(""); }}><option value="all">Tất cả nhà cung cấp</option>{providers.map((value) => <option key={value} value={value}>{providerLabels[value] ?? value} ({allVoices.filter((voice) => voice.provider === value).length})</option>)}</select>
      <select className="rounded-lg border border-current/20 bg-transparent px-2 py-2" aria-label="Giọng đọc" value={selectedVoice} onChange={(event) => { invalidateSetting(); setVoiceId(event.target.value); }}>{providers.map((value) => { const grouped = visibleVoices.filter((voice) => voice.provider === value); return grouped.length ? <optgroup key={value} label={providerLabels[value] ?? value}>{grouped.map((voice) => <option key={voice.id} value={voice.id}>{voice.name}</option>)}</optgroup> : null; })}</select>
      <select className="rounded-lg border border-current/20 bg-transparent px-2 py-2" aria-label="Preset giọng" value={preset} onChange={(event) => applyPreset(event.target.value)}><option value="narrator">Narrator</option><option value="deep">Deep male</option><option value="soft">Soft female</option><option value="fantasy">Fantasy</option><option value="romance">Romance</option><option value="mystery">Mystery</option><option value="taothao">Tào Tháo</option></select>
      <label className="flex items-center gap-1">Tốc độ <input aria-label="Tốc độ" type="range" min="0.5" max="2" step="0.1" value={speakingRate} onChange={(event) => { invalidateSetting(); setSpeakingRate(Number(event.target.value)); }} /> {speakingRate}x</label>
      <label className="flex items-center gap-1">Cao độ <input aria-label="Cao độ" type="range" min="-20" max="20" step="1" value={pitch} disabled={isFixedPitchProvider} title={selectedVoiceInfo?.provider === "saydi" ? "SaydiVoice chưa hỗ trợ cao độ" : selectedVoiceInfo?.provider === "local" ? "Giọng local offline chưa hỗ trợ cao độ" : undefined} onChange={(event) => { invalidateSetting(); setPitch(Number(event.target.value)); }} /> {isFixedPitchProvider ? "Không hỗ trợ" : pitch}</label>
      <label className="flex items-center gap-1">Âm lượng <input aria-label="Âm lượng" type="range" min="0" max="1" step="0.1" value={volume} onChange={(event) => { const next = Number(event.target.value); setVolume(next); if (audioRef.current) audioRef.current.volume = next; }} /> {Math.round(volume * 100)}%</label>
      <label className="flex items-center gap-1">Phát lại <select aria-label="Tốc độ phát lại" className="rounded-lg border border-current/20 bg-transparent px-2 py-1" value={playbackRate} onChange={(event) => { const value = Number(event.target.value); setPlaybackRate(value); if (audioRef.current) audioRef.current.playbackRate = value; }}><option value="0.75">0.75x</option><option value="1">1x</option><option value="1.25">1.25x</option><option value="1.5">1.5x</option></select></label>
    </div>
    {error && <p className="mt-3 text-sm text-red-700" role="alert">{error}</p>}
    {voices.data.length === 1 && voices.data[0].provider === "mock" && <p className="mt-3 text-xs opacity-60">Đang dùng voice demo. Chạy lại start-reader.ps1 để cài Edge-TTS miễn phí.</p>}
    <audio ref={audioRef} className="mt-3 w-full" controls onPlay={(event) => { if (!event.currentTarget.paused) useTtsSession.setState({ running: true }); }} onPlaying={() => void prefetchNext(activeIndex.current).catch(() => undefined)} onEnded={() => playNext(true)} onVolumeChange={(event) => setVolume(event.currentTarget.volume)} />
    <p className="mt-2 opacity-60">Đoạn {chunkIndex + 1}/{chunks.data.length} · Tự đọc chương kế tiếp đến khi bấm Dừng.</p>
  </div>;
}
