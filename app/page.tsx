import type { Metadata } from "next";
import { isAuthenticatedNextjs } from "@convex-dev/auth/nextjs/server";
import Link from "next/link";
import HomeFeed from "@/components/home-feed";
import DemoFeed from "@/components/demo-feed";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = {
  title: "Warmline · The For You feed for your warm network",
  description:
    "Warmline ranks who to reach out to, why they fit your goal, and the warmest path to an intro. Invite-only beta with a live demo feed.",
};

// The landing route. The server branches on the auth cookie:
//   • signed in  → your feed (components/home-feed.tsx, api.feed.list)
//   • signed out → server-rendered marketing copy (crawlable in the initial
//     HTML) + the demo account's read-only feed hydrating client-side (api.demo.*)
// Branching on the server keeps the two surfaces structurally apart: the
// signed-out page never subscribes to a real user's queries (nothing to flash
// during auth hydration), and a signed-in visitor never mounts the demo feed.
export default async function Home() {
  if (await isAuthenticatedNextjs()) return <HomeFeed />;
  return (
    <div className="w-full px-4 py-8">
      <section className="mb-10 max-w-2xl">
        <h1 className="text-3xl font-semibold tracking-tight">
          Your network already knows your next customer
        </h1>
        <p className="mt-3 text-base text-foreground/60">
          Warmline ranks who to reach out to, why they fit your goal, and the
          warmest path to an intro. This is a live demo feed, refreshed daily.
          Click a row to trace its warm path.
        </p>
        <div className="mt-5 flex items-center gap-3">
          <Button variant="primary" asChild>
            <Link href="/signin">Create your feed</Link>
          </Button>
          <span className="text-sm text-muted-foreground">
            Invite-only beta
          </span>
        </div>
      </section>
      <DemoFeed />
    </div>
  );
}
