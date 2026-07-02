"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useMutation } from "convex/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { FeedList } from "@/components/feed-list";
import { WarmPath } from "@/components/warm-path";

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

  // The vote wheel: a voted row cycles toward the bottom of the list (the
  // feedback is "heard", the slot opens for the next person) while its vote
  // state persists on the thumb. Purely visual and local — scores and the
  // stored order don't change until the daily re-rank.
  const [demoted, setDemoted] = useState<ReadonlyMap<Id<"persons">, number>>(
    new Map(),
  );
  const demoteSeq = useRef(0);

  // When the server pushes a fresh feed (the daily re-rank landing
  // mid-session, or any recommendations change), the new order is
  // authoritative: drop the local demotions rather than pinning up-voted
  // rows below people the new rank scored lower. Reset-during-render is
  // React's pattern for state that derives from a changed subscription value.
  const [lastFeed, setLastFeed] = useState(feed);
  if (feed !== lastFeed) {
    setLastFeed(feed);
    if (demoted.size > 0) setDemoted(new Map());
  }

  const rows = useMemo(() => {
    const data = [...(feed ?? [])].sort((a, b) => b.score - a.score);
    if (demoted.size === 0) return data;
    const ranked = data.filter((r) => !demoted.has(r.id));
    const cycled = data
      .filter((r) => demoted.has(r.id))
      .sort((a, b) => demoted.get(a.id)! - demoted.get(b.id)!);
    return [...ranked, ...cycled];
  }, [feed, demoted]);

  // The goal line under the title (S3): the real goal text, trimmed so the
  // header stays one line, with the amber Edit goal link into the wizard.
  const goal =
    icp && icp.text.length > 72 ? `${icp.text.slice(0, 72)}…` : icp?.text;

  return (
    <div className="mx-auto w-full max-w-3xl px-6 py-10">
      <header className="mb-7">
        <h1 className="font-display text-[28px] font-semibold tracking-tight text-foreground">
          Who to reach out to
        </h1>
        <p className="mt-1.5 text-sm text-foreground/60">
          {goal ? (
            <>Ranked for your goal: {goal} </>
          ) : (
            <>Ranked by warm path and goal fit, refreshed daily </>
          )}
          <Link
            href="/onboarding"
            className="font-medium text-primary underline-offset-4 hover:underline"
          >
            Edit goal
          </Link>
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
        <FeedList
          rows={rows}
          voteFor={voteFor}
          onVote={(personId, v) => {
            if (icp) {
              void vote({ icpId: icp._id, personId, vote: v });
              setDemoted((prev) =>
                new Map(prev).set(personId, demoteSeq.current++),
              );
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
      <div className="flex h-[160px] items-center justify-center text-xs text-muted-foreground">
        Tracing the warm path…
      </div>
    );
  return <WarmPath data={data} />;
}
