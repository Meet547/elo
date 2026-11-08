import type { Metadata, Viewport } from "next";
import "@fontsource/ibm-plex-mono/latin-400.css";
import "@fontsource/ibm-plex-mono/latin-500.css";
import "@fontsource/ibm-plex-mono/latin-600.css";
import "@fontsource/ibm-plex-mono/latin-700.css";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";
import { MotionProvider } from "@/components/felt/motion-provider";
import { ACE_OF_SPADES_SRC } from "@/components/felt/poker-assets";
import { SITE_NAME, SITE_URL } from "@/lib/site";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  applicationName: SITE_NAME,
  icons: [{ url: ACE_OF_SPADES_SRC, type: "image/svg+xml" }],
  title: {
    default: `${SITE_NAME} — Rated Poker`,
    template: `%s · ${SITE_NAME}`,
  },
  description:
    "Play ten-hand ranked Hold’em against real opponents near your rating, or create a private table with friends.",
  openGraph: {
    title: `${SITE_NAME} — Rated Poker`,
    description:
      "Real opponents, nearby ratings, ten hands. Your next match starts with your new rating.",
    siteName: SITE_NAME,
    type: "website",
    url: SITE_URL,
    locale: "en_US",
  },
  twitter: {
    card: "summary_large_image",
    title: `${SITE_NAME} — Rated Poker`,
    description: "Ranked heads-up Hold’em. Ten hands, real opponents, one rating.",
  },
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  themeColor: "#f4f1e9",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="antialiased bg-canvas text-ink font-sans">
        <MotionProvider>{children}</MotionProvider>
        <Toaster />
      </body>
    </html>
  );
}
