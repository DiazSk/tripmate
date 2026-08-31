import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "TripMate — Plan your trip",
    short_name: "TripMate",
    description: "AI-planned itineraries with real weather, budget tracking, and maps.",
    start_url: "/",
    display: "standalone",
    background_color: "#091b20",
    theme_color: "#091b20",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
  };
}
