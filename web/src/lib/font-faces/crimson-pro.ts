import { Crimson_Pro } from "next/font/google";

// Loaded on demand by loadReadingFont(); `vietnamese` carries the diacritics. next/font needs literal options.
export const face = Crimson_Pro({ subsets: ["latin", "latin-ext", "vietnamese"], display: "swap", preload: false, variable: "--font-crimson-pro" });
