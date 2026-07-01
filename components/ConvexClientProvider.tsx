"use client";

import { ConvexAuthNextjsProvider } from "@convex-dev/auth/nextjs";
import { ConvexReactClient } from "convex/react";
import { ReactNode } from "react";

const convex = new ConvexReactClient(process.env.NEXT_PUBLIC_CONVEX_URL!);

// Client auth provider. It reads the auth state supplied by the server provider
// (ConvexAuthNextjsServerProvider in app/layout.tsx) — both are required. The
// earlier crash ("Cannot destructure property isLoading of useAuth(...)") was the
// server provider being absent, so this provider's context was undefined.
export default function ConvexClientProvider({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <ConvexAuthNextjsProvider client={convex}>
      {children}
    </ConvexAuthNextjsProvider>
  );
}
