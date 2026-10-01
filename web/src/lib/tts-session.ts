import { create } from "zustand";

// Session only: reloading the page must never start reading automatically.
export const useTtsSession = create(() => ({
  voiceId: "", speakingRate: 1, pitch: 0, volume: 1, playbackRate: 1,
  preset: "narrator", provider: "all", running: false, autoplayChapterId: "",
}));
