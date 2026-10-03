import type { AmbientSound } from "./ambient-sounds";

let context: AudioContext | null = null;
let gain: GainNode | null = null;
type Track = { source: AudioBufferSourceNode; fade: GainNode; sound: AmbientSound; ended: Promise<void>; finish: () => void };
let current: Track | null = null;
let retiring: Track | null = null;
let generation = 0;

function disconnect(track: Track | null) {
  if (!track) return;
  track.source.onended = null;
  track.source.stop();
  track.source.disconnect();
  track.fade.disconnect();
  track.finish();
}

// Bake filtering and slow envelopes into one mono loop: no perpetual JS timer.
function makeBuffer(audio: AudioContext, sound: AmbientSound) {
  const rate = audio.sampleRate;
  const fade = Math.floor(rate * 0.1);
  const buffer = audio.createBuffer(1, rate * 12 + fade, rate);
  const samples = buffer.getChannelData(0);
  const rows = Array.from({ length: 16 }, () => Math.random() * 2 - 1);
  let pinkSum = rows.reduce((sum, value) => sum + value, 0);
  let brown = 0, low = 0;
  const cutoff = { brown: 700, white: 12000, pink: 8000, fan: 650, rain: 2500, wind: 500, waves: 1800, stream: 4000 }[sound];
  const smoothing = 1 - Math.exp(-2 * Math.PI * cutoff / rate);
  const brownSmoothing = 1 - Math.exp(-2 * Math.PI * 100 / rate);
  let mean = 0;
  for (let i = 0; i < samples.length; i++) {
    const white = Math.random() * 2 - 1;
    // Voss-style octave rows, plus white noise to fill the highest octave.
    let row = 0;
    for (let bits = (i + 1) & 65535; row < 15 && (bits & 1) === 0; bits >>= 1) row++;
    pinkSum -= rows[row];
    rows[row] = Math.random() * 2 - 1;
    pinkSum += rows[row];
    const pink = (pinkSum + white) / 5;
    brown += brownSmoothing * (white - brown);
    const phase = 2 * Math.PI * i / (rate * 12);
    let value: number;
    switch (sound) {
      case "brown": value = brown * 4; break;
      case "white": value = white; break;
      case "pink": value = pink; break;
      case "fan": value = pink + 0.055 * Math.sin(2 * Math.PI * 90 * i / rate); break;
      case "rain": value = white * (0.85 + 0.1 * Math.sin(phase * 4)); break;
      case "wind": value = pink * (0.6 + 0.25 * Math.sin(phase) + 0.1 * Math.sin(phase * 3)); break;
      case "waves": value = (pink * 0.65 + white * 0.35) * (0.25 + 0.75 * ((1 - Math.cos(phase * 2)) / 2) ** 2); break;
      case "stream": value = (white * 0.65 + pink * 0.35) * (0.8 + 0.12 * Math.sin(phase * 19) + 0.08 * Math.sin(phase * 43)); break;
    }
    low += smoothing * (value - low);
    samples[i] = low;
    mean += low;
  }
  mean /= samples.length;
  for (let i = 0; i < samples.length; i++) samples[i] -= mean;
  // Tail blends into the first 100ms, then loops to the end of that overlap.
  for (let i = 0; i < fade; i++) {
    const mix = i / (fade - 1);
    const end = samples.length - fade + i;
    samples[end] = samples[end] * (1 - mix) + samples[i] * mix;
  }
  let energy = 0, peak = 0;
  for (const value of samples) { energy += value * value; peak = Math.max(peak, Math.abs(value)); }
  const scale = Math.min(0.16 / Math.max(1e-8, Math.sqrt(energy / samples.length)), 0.8 / Math.max(1e-8, peak));
  for (let i = 0; i < samples.length; i++) samples[i] *= scale;
  return { buffer, loopStart: fade / rate };
}

function ramp(param: AudioParam, value: number, now: number, seconds: number) {
  if (typeof param.cancelAndHoldAtTime === "function") param.cancelAndHoldAtTime(now);
  else { const held = param.value; param.cancelScheduledValues(now); param.setValueAtTime(held, now); }
  param.linearRampToValueAtTime(value, now + seconds);
}

export async function startAmbient(sound: AmbientSound) {
  if (!context || context.state === "closed") {
    context = new AudioContext();
    gain = context.createGain();
    gain.gain.value = 0;
    gain.connect(context.destination);
  }
  const audio = context;
  const request = ++generation;
  await audio.resume();
  if (request !== generation || context !== audio) return false;
  if (document.hidden) { suspendAmbient(); return false; }
  if (current?.sound === sound) return true;
  // Finish the current crossfade before switching again; pending choices are
  // superseded by generation, rather than cutting an audible source abruptly.
  await retiring?.ended;
  if (request !== generation || context !== audio) return false;
  if (document.hidden) { suspendAmbient(); return false; }
  const { buffer, loopStart } = makeBuffer(audio, sound);
  const source = audio.createBufferSource();
  source.buffer = buffer;
  source.loop = true;
  source.loopStart = loopStart;
  const fade = audio.createGain();
  fade.gain.value = 0;
  source.connect(fade).connect(gain!);
  const now = audio.currentTime;
  retiring = current;
  if (retiring) {
    const old = retiring;
    ramp(old.fade.gain, 0, now, 0.25);
    old.source.stop(now + 0.25);
  }
  let finish!: () => void;
  const ended = new Promise<void>((resolve) => { finish = resolve; });
  const track = { source, fade, sound, ended, finish };
  source.onended = () => {
    source.disconnect(); fade.disconnect(); finish();
    if (retiring === track) retiring = null;
  };
  current = track;
  source.start(now, loopStart);
  fade.gain.linearRampToValueAtTime(1, now + 0.25);
  return true;
}

export function setAmbientGain(volume: number, speechPlaying: boolean) {
  if (!context || !gain) return;
  ramp(gain.gain, Math.max(0, Math.min(0.3, volume)) * (speechPlaying ? 0.3 : 1), context.currentTime, speechPlaying ? 0.25 : 0.8);
}

export function suspendAmbient() { generation++; void context?.suspend(); }
export function closeAmbient() {
  generation++;
  disconnect(current); disconnect(retiring);
  gain?.disconnect();
  void context?.close();
  current = null; retiring = null; gain = null; context = null;
}
