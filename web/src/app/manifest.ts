import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return { name: "Gác Sách", short_name: "Gác Sách", description: "Không gian đọc sách và nghe giọng kể", lang: "vi", start_url: "/library", display: "standalone", background_color: "#f4efe7", theme_color: "#3e593e", icons: [{ src: "/pwa-192.png", sizes: "192x192", type: "image/png", purpose: "any" }, { src: "/pwa-512.png", sizes: "512x512", type: "image/png", purpose: "any" }] };
}
