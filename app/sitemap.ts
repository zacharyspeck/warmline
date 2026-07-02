import type { MetadataRoute } from "next";

// Public, indexable routes only. Driven by NEXT_PUBLIC_SITE_URL (set after
// the domain purchase; see .env.example and MANUAL_TODO.md) with a localhost
// fallback so dev builds still emit a valid sitemap.
const site = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

export default function sitemap(): MetadataRoute.Sitemap {
  return ["/", "/pricing", "/signin", "/privacy", "/terms"].map((path) => ({
    url: new URL(path, site).toString(),
    lastModified: new Date(),
  }));
}
