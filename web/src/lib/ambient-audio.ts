let context: AudioContext | null = null;
let source: AudioBufferSourceNode | null = null;
let gain: GainNode | null = null;
let filter: BiquadFilterNode | null = null;
let currentSound = "";
let generation = 0;

export async function startAmbient(sound: "brown" | "rain") {
  if (!context || context.state === "closed") context = new AudioContext();
  const activeContext = context;
  const request = ++generation;
  await activeContext.resume();
  if (request !== generation || context !== activeContext) return;
  if (source && currentSound === sound) return;
  source?.stop();
  source?.disconnect();
  filter?.disconnect();
  gain?.disconnect();
  const buffer = context.createBuffer(1, context.sampleRate * 8, context.sampleRate);
  const samples = buffer.getChannelData(0);
  let brown = 0;
  for (let i = 0; i < samples.length; i++) {
    const noise = Math.random() * 2 - 1;
    brown = (brown + 0.02 * noise) / 1.02;
    samples[i] = sound === "brown" ? brown * 3.5 : noise * 0.3;
  }
  // Crossfade the loop seam, avoiding a periodic click.
  const fade = Math.floor(context.sampleRate * 0.05);
  for (let i = 0; i < fade; i++) samples[samples.length - fade + i] = samples[samples.length - fade + i] * (1 - i / fade) + samples[i] * (i / fade);
  source = context.createBufferSource();
  source.buffer = buffer;
  source.loop = true;
  source.loopStart = fade / context.sampleRate;
  filter = context.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value = sound === "brown" ? 700 : 2500;
  gain = context.createGain();
  gain.gain.value = 0;
  source.connect(filter).connect(gain).connect(context.destination);
  source.start();
  currentSound = sound;
}

export function setAmbientGain(volume: number, speechPlaying: boolean) {
  if (!context || !gain) return;
  const now = context.currentTime;
  gain.gain.cancelScheduledValues(now);
  gain.gain.setValueAtTime(gain.gain.value, now);
  gain.gain.linearRampToValueAtTime(Math.max(0, Math.min(0.3, volume)) * (speechPlaying ? 0.3 : 1), now + (speechPlaying ? 0.25 : 0.8));
}

export function suspendAmbient() { void context?.suspend(); }
export function closeAmbient() {
  generation++;
  source?.stop();
  source?.disconnect();
  filter?.disconnect();
  gain?.disconnect();
  void context?.close();
  source = null; filter = null; gain = null; context = null; currentSound = "";
}
