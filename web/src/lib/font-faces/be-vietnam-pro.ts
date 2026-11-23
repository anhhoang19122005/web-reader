import { Be_Vietnam_Pro } from "next/font/google";

// Loaded on demand by loadReadingFont(); `vietnamese` carries the diacritics. next/font needs literal options.
export const face = Be_Vietnam_Pro({ weight: ["400", "500", "600", "700"], subsets: ["latin", "latin-ext", "vietnamese"], display: "swap", preload: false, variable: "--font-be-vietnam-pro" });
