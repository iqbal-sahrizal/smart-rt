import type { MetadataRoute } from "next"

import { brandPalette } from "@/lib/design-tokens"

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/resident",
    name: "Smart RT",
    short_name: "Smart RT",
    description: "Modern neighborhood & community management platform.",
    start_url: "/resident",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: brandPalette.background,
    theme_color: brandPalette.primary,
    categories: ["productivity", "utilities", "lifestyle"],
    icons: [
      {
        src: "/icons/icon-192x192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-512x512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-maskable-192x192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "maskable",
      },
      {
        src: "/icons/icon-maskable-512x512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  }
}

