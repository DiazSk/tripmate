import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "TripMate — Plan your trip",
    short_name: "TripMate",
    description: "AI-planned itineraries with real weather, budget tracking, and maps.",
    start_url: "/",
    display: "standalone",
    background_color: "#121110",
    theme_color: "#121110",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      // Separate file, not `purpose: "any maskable"` on the 512: the maskable art is inset to the
      // 80% safe zone, and on an unmasked surface that inset reads as a shrunken icon in a moat.
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
