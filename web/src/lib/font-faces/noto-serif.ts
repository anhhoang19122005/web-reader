import { Noto_Serif } from "next/font/google";

// Loaded on demand by loadReadingFont(); `vietnamese` carries the diacritics. next/font needs literal options.
export const face = Noto_Serif({ subsets: ["latin", "latin-ext", "vietnamese"], display: "swap", preload: false, variable: "--font-noto-serif" });
