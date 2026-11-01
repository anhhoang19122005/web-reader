import localFont from "next/font/local";
import type { Metadata, Viewport } from "next";
import { Providers } from "./providers";
import "./globals.css";

const readerSerif = localFont({ src: "./fonts/SourceSerif4Variable-Roman.ttf", variable: "--font-reader-serif", display: "swap", weight: "200 900" });
export const viewport: Viewport = { themeColor: "#f4efe7" };

export const metadata: Metadata = {
  title: { default: "Gác Sách", template: "%s · Gác Sách" },
  appleWebApp: { capable: true, title: "Gác Sách" },
  description: "Đọc EPUB và PDF với tiếng nói tiếng Việt.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="vi" suppressHydrationWarning className={`h-full antialiased ${readerSerif.variable}`}>
      <head><script dangerouslySetInnerHTML={{ __html: `try{const t=JSON.parse(localStorage.getItem("gac-sach-preferences")||"null")?.state?.theme;const c={light:"#f5f7f3",sepia:"#f4efe7",dark:"#151d18",forest:"#18251e",ocean:"#edf4f7",sakura:"#faf0f3",sunset:"#292126",thanhlong:"#0e1f1d",bachho:"#f1efe9",chutuoc:"#200f0d",huyenvu:"#0b1220",hondon:"#17121f",cungky:"#14161f",daongot:"#1b1a14",thaothiet:"#1a1512"};if(Object.hasOwn(c,t)){document.documentElement.dataset.theme=t;document.querySelector('meta[name="theme-color"]')?.setAttribute("content",c[t])}}catch{}` }} /></head>
      <body className="min-h-full flex flex-col">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
