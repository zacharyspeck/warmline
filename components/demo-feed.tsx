"use client";

import { useEffect, useMemo, useState } from "react";
import { useConvexAuth, useQuery } from "convex/react";
import { useRouter } from "next/navigation";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { FeedList } from "@/components/feed-list";
import { WarmPath } from "@/components/warm-path";
import { SignupPrompt } from "@/components/signup-prompt";

// The read-only demo feed on the logged-out landing page. Subscribes ONLY to
// the demo surface (api.demo.*), which the server scopes to the demo account —
// so this component structurally cannot render a real user's data, no matter
// the auth state during hydration. Votes write nothing: they open a sign-up
// prompt instead.

const NO_VOTES: ReadonlyMap<Id<"persons">, "up" | "down"> = new Map();

export default function DemoFeed() {
  const router = useRouter();
  const { isAuthenticated } = useConvexAuth();
  const [signupOpen, setSignupOpen] = useState(false);

  // If a session appears (e.g. the user signed in from another tab), swap the
  // stale demo landing for the server's signed-in branch.
  useEffect(() => {
    if (isAuthenticated) router.refresh();
  }, [isAuthenticated, router]);

  const feed = useQuery(api.demo.feed, {});
  const rows = useMemo(() => {
    const data = feed ?? [];
    return [...data].sort((a, b) => b.score - a.score);
  }, [feed]);

  return (
    <>
      {feed === undefined ? (
        <p className="py-16 text-center text-sm text-muted-foreground">
          Loading the demo network…
        </p>
      ) : rows.length === 0 ? (
        <p className="py-16 text-center text-sm text-muted-foreground">
          The demo network is warming up. Check back soon
        </p>
      ) : (
        <FeedList
          rows={rows}
          voteFor={NO_VOTES}
          onVote={() => setSignupOpen(true)}
          renderGraph={(personId) => <DemoGraphAccordion personId={personId} />}
        />
      )}

      <SignupPrompt open={signupOpen} onOpenChange={setSignupOpen} />
    </>
  );
}

function DemoGraphAccordion({ personId }: { personId: Id<"persons"> }) {
  const data = useQuery(api.demo.pathForPerson, { personId });
  if (data === undefined)
    return (
      <div className="flex h-[200px] items-center justify-center text-xs text-muted-foreground">
        Tracing the warm path…
      </div>
    );
  return <WarmPath data={data} />;
}
