import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
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
  title: "Demaze AI: Outbound Intelligence Platform",
  description: "AI-powered company intelligence for B2B outbound sales targeting manufacturing and automotive industries.",
  manifest: "/manifest.webmanifest",
  // 2026-08-04 mobile pass - makes the admin product installable/full-screen
  // on iOS home-screen (Safari doesn't read the web manifest for this, only
  // these meta tags). apple-touch-icon matches manifest.ts's PNG icon set.
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Demaze",
  },
  icons: {
    apple: "/icons/apple-touch-icon.png",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // viewport-fit=cover lets content extend under the iOS notch/home
  // indicator so env(safe-area-inset-*) below has real space to work with -
  // without this, those env() values are always 0 and the bottom tab bar
  // would sit flush against (or under) the home-indicator gesture area.
  viewportFit: "cover",
  themeColor: "#0a0a0b",
  // Deliberately NOT disabling pinch-zoom (no maximumScale: 1 /
  // userScalable: false) - that's a real accessibility regression for
  // low-vision users, and nothing about "feels like an app" requires it.
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`dark ${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
