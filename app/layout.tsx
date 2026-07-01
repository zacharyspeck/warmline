import type { Metadata } from "next";
import { Geist, Geist_Mono, Schibsted_Grotesk } from "next/font/google";
import { ConvexAuthNextjsServerProvider } from "@convex-dev/auth/nextjs/server";
import "./globals.css";
import ConvexClientProvider from "@/components/ConvexClientProvider";
import AppChrome from "@/components/app-chrome";
const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// Display / wordmark face. Brand spec: Schibsted Grotesk 600.
const schibsted = Schibsted_Grotesk({
  variable: "--font-schibsted",
  subsets: ["latin"],
  weight: ["500", "600", "700"],
});

export const metadata: Metadata = {
  title: "Warmline",
  description:
    "The For You feed for your warm network. Who to reach out to, why, and how",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // The server provider must wrap the tree so the client auth provider has a
  // defined auth state on both server and client render.
  return (
    <ConvexAuthNextjsServerProvider>
      <html lang="en" className="dark">
        <body
          className={`${geistSans.variable} ${geistMono.variable} ${schibsted.variable} font-sans antialiased min-h-screen bg-background text-foreground`}
        >
          <ConvexClientProvider>
            <AppChrome>{children}</AppChrome>
          </ConvexClientProvider>
        </body>
      </html>
    </ConvexAuthNextjsServerProvider>
  );
}
