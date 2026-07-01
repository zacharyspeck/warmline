"use client";

import { ConvexProvider, ConvexReactClient } from "convex/react";
import { ReactNode } from "react";

const convex = new ConvexReactClient(process.env.NEXT_PUBLIC_CONVEX_URL!);

// Auth is dormant for this phase (the public demo has no login), so we mount a
// plain Convex provider. The @convex-dev/auth wrapper (ConvexAuthNextjsProvider)
// requires the server provider + middleware to be configured; without them its
// internal useAuth() is undefined and every route throws
// "Cannot destructure property 'isLoading' of useAuth(...)". The auth files
// (convex/auth.ts, app/signin, proxy.ts) stay in place — swap this back to
// ConvexAuthNextjsProvider in Phase 2 once auth is wired up.
export default function ConvexClientProvider({
  children,
}: {
  children: ReactNode;
}) {
  return <ConvexProvider client={convex}>{children}</ConvexProvider>;
}
