import type { MetadataRoute } from "next";

const site = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        // Signed-in app surfaces carry nothing for a crawler.
        disallow: ["/settings", "/connectors", "/onboarding", "/server"],
      },
    ],
    sitemap: new URL("/sitemap.xml", site).toString(),
  };
}
