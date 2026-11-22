import { create } from "zustand";
import type { TtsMark } from "./api";

// Session only: reloading the page must never start reading automatically.
export const useTtsSession = create(() => ({
  voiceId: "", speakingRate: 1, pitch: 0, volume: 1, playbackRate: 1,
  preset: "narrator", provider: "all", running: false, speechPlaying: false, autoplayChapterId: "",
  // Timing marks of the audio now loaded in the player.
  marks: [] as TtsMark[],
}));
