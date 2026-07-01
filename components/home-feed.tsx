"use client";

import { useEffect, useMemo } from "react";
import { useQuery, useMutation } from "convex/react";
import { useRouter } from "next/navigation";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { FeedTable } from "@/components/feed-table";
import { WarmGraph } from "@/components/warm-graph";

// The signed-in feed. Rendered by app/page.tsx only for authenticated visitors
// (the server branches on the auth cookie); signed-out visitors get the demo
// landing instead, so this component never mounts without a session.
export default function HomeFeed() {
  const router = useRouter();

  const feed = useQuery(api.feed.list, { limit: 40 });
  const icp = useQuery(api.icp.latest, {});

  useEffect(() => {
    if (icp === null) router.replace("/onboarding");
  }, [icp, router]);
  const votes = useQuery(
    api.feedback.forIcp,
    icp ? { icpId: icp._id } : "skip",
  );
  const voteFor = useMemo(() => {
    const m = new Map<Id<"persons">, "up" | "down">();
    for (const v of votes ?? []) m.set(v.personId, v.vote);
    return m;
  }, [votes]);

  // Optimistic: write the vote into the feedback.forIcp cache immediately, then
  // let the server query confirm. The selected thumb reflects state at once and
  // still reads back correctly after a reload (forIcp returns persisted votes).
  const vote = useMutation(api.feedback.vote).withOptimisticUpdate(
    (store, args) => {
      const q = { icpId: args.icpId };
      const current = store.getQuery(api.feedback.forIcp, q);
      if (current === undefined) return;
      const next = current.filter((v) => v.personId !== args.personId);
      next.push({ personId: args.personId, vote: args.vote });
      store.setQuery(api.feedback.forIcp, q, next);
    },
  );

  const rows = useMemo(() => {
    const data = feed ?? [];
    return [...data].sort((a, b) => b.score - a.score);
  }, [feed]);

  return (
    <div className="w-full px-4 py-8">
      <header className="mb-7">
        <h1 className="text-xl font-semibold tracking-tight">
          Who to reach out to
        </h1>
        <p className="mt-1.5 text-sm text-foreground/60">
          Ranked by how warm the path is and how well they fit your goal,{" "}
          <span className="text-foreground/80 font-medium">refreshed daily</span>
        </p>
      </header>

      {feed === undefined ? (
        <p className="py-16 text-center text-sm text-muted-foreground">
          Loading your network…
        </p>
      ) : rows.length === 0 ? (
        <p className="py-16 text-center text-sm text-muted-foreground">
          No people yet. Connect a source to load your network
        </p>
      ) : (
        <FeedTable
          rows={rows}
          voteFor={voteFor}
          onVote={(personId, v) => {
            if (icp) {
              void vote({ icpId: icp._id, personId, vote: v });
            }
          }}
          renderGraph={(personId) => <GraphAccordion personId={personId} />}
        />
      )}
    </div>
  );
}

function GraphAccordion({ personId }: { personId: Id<"persons"> }) {
  const data = useQuery(api.graph.pathForPerson, { personId });
  if (data === undefined)
    return (
      <div className="flex h-[200px] items-center justify-center text-xs text-muted-foreground">
        Tracing the warm path…
      </div>
    );
  return <WarmGraph data={data} />;
}
