import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { LlmTraceFabProvider } from "@/components/LlmTraceFab";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "TripMate — Plan your trip",
  description: "AI-planned itineraries with real weather, budget tracking, and maps.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <LlmTraceFabProvider>{children}</LlmTraceFabProvider>
      </body>
    </html>
  );
}
