import type { Metadata } from "next";
import { Geist, Geist_Mono, Schibsted_Grotesk } from "next/font/google";
import {
  ConvexAuthNextjsServerProvider,
  convexAuthNextjsToken,
} from "@convex-dev/auth/nextjs/server";
import "./globals.css";
import ConvexClientProvider from "@/components/ConvexClientProvider";
import AppChrome from "@/components/app-chrome";
const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

// Monospace is only used in rare kbd chips, never above the fold — don't
// preload it (it still self-hosts and swaps in when a mono glyph renders).
const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
  preload: false,
});

// Display / wordmark face. Brand spec: Schibsted Grotesk 600 — the only weight
// the UI actually uses, so we ship just that one file (was 500/600/700).
const schibsted = Schibsted_Grotesk({
  variable: "--font-schibsted",
  subsets: ["latin"],
  weight: ["600"],
});

export const metadata: Metadata = {
  // Absolute URLs for OG/twitter cards resolve against the real domain once
  // NEXT_PUBLIC_SITE_URL is set (post domain purchase; see MANUAL_TODO.md).
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000",
  ),
  title: "Warmline",
  description:
    "The For You feed for your warm network. Who to reach out to, why, and how",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // The server knows the auth branch from the request cookie — hand it to the
  // chrome so nav renders stable on first paint instead of waiting on a client
  // query. Token PRESENCE is deliberate (isAuthenticatedNextjs would validate
  // against the Convex backend on every request for every route, and a blip
  // there would hand a signed-in user the signed-out rail); an expired token
  // just means a nav click lands on the middleware's real check.
  const authed = (await convexAuthNextjsToken()) !== undefined;
  // The server provider must wrap the tree so the client auth provider has a
  // defined auth state on both server and client render.
  return (
    <ConvexAuthNextjsServerProvider>
      <html lang="en" className="dark">
        <body
          className={`${geistSans.variable} ${geistMono.variable} ${schibsted.variable} font-sans antialiased min-h-screen bg-background text-foreground`}
        >
          <ConvexClientProvider>
            <AppChrome authed={authed}>{children}</AppChrome>
          </ConvexClientProvider>
        </body>
      </html>
    </ConvexAuthNextjsServerProvider>
  );
}
