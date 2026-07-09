"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useMutation } from "convex/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import type { FunctionReturnType } from "convex/server";
import dynamic from "next/dynamic";
import { FeedList } from "@/components/feed-list";
import { AddTargets } from "@/components/add-targets";
import { Button } from "@/components/ui/button";
import { ChevronDownIcon, ChevronUpIcon } from "@/components/icons";

// The React Flow warm-path graph is heavy (canvas + its stylesheet); code-split
// it so it only loads when a card actually expands.
const WarmGraph = dynamic(
  () => import("@/components/warm-graph").then((m) => m.WarmGraph),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-[340px] items-center justify-center rounded-xl border border-border bg-background/40 text-xs text-muted-foreground">
        Loading the warm path…
      </div>
    ),
  },
);

// The signed-in feed. Rendered by app/page.tsx only for authenticated visitors
// (the server branches on the auth cookie); signed-out visitors get the demo
// landing instead, so this component never mounts without a session.
export default function HomeFeed() {
  const router = useRouter();

  const feed = useQuery(api.feed.list, { limit: 40 });
  // The UTC day is part of the status subscription key: budgets reset on the
  // day rollover, and without re-subscribing a "capped" answer from last
  // night would stick around after the reset (queries only re-run on data
  // changes, not on time passing).
  const [day, setDay] = useState(() => new Date().toISOString().slice(0, 10));
  useEffect(() => {
    const t = setInterval(
      () => setDay(new Date().toISOString().slice(0, 10)),
      60_000,
    );
    return () => clearInterval(t);
  }, []);
  const status = useQuery(api.feed.status, { day });
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

  // The feed splits into two sections: the headline is new people to reach
  // (leads); in-network people to reconnect with (connectors) sit in a
  // collapsed secondary section. Order within each preserves the ranked +
  // vote-cycled order above.
  const leads = useMemo(() => rows.filter((r) => r.kind === "lead"), [rows]);
  const connectors = useMemo(
    () => rows.filter((r) => r.kind === "connector"),
    [rows],
  );
  const hasLeads = leads.length > 0;

  const onVoteRow = (personId: Id<"persons">, v: "up" | "down") => {
    if (!icp) return;
    void vote({ icpId: icp._id, personId, vote: v });
    setDemoted((prev) => new Map(prev).set(personId, demoteSeq.current++));
  };
  const renderGraph = (personId: Id<"persons">) => (
    <GraphAccordion personId={personId} />
  );

  // The goal line under the title (S3): the real goal text, trimmed so the
  // header stays one line, with the amber Edit goal link into the Goals editor.
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
            href="/goals"
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
        <EmptyFeed status={status} />
      ) : (
        <>
          {status && status.hasPersons && !status.ranked ? (
            <p className="mb-4 rounded-lg border border-border bg-card px-4 py-3 text-sm text-muted-foreground">
              {status.embedCapped
                ? "Your network is imported, but today's ranking budget is used up. People are ordered by tie strength until ranking resumes tomorrow"
                : "Your network is imported but not yet ranked against your goal, so this order is provisional. Ranking runs after an import and with the daily refresh"}
            </p>
          ) : null}

          {hasLeads ? (
            <>
              <FeedList
                rows={leads}
                voteFor={voteFor}
                onVote={onVoteRow}
                renderGraph={renderGraph}
              />
              {connectors.length > 0 ? (
                <ReconnectSection count={connectors.length}>
                  <FeedList
                    rows={connectors}
                    voteFor={voteFor}
                    onVote={onVoteRow}
                    renderGraph={renderGraph}
                  />
                </ReconnectSection>
              ) : null}
            </>
          ) : (
            // Zero leads: point the user at ways to add people, and offer at
            // most five warm connectors to start with — never the full wall.
            <>
              <ZeroLeadCTA />
              {connectors.length > 0 ? (
                <section className="mt-8">
                  <h2 className="mb-3 text-[13px] font-medium uppercase tracking-[0.1em] text-muted-foreground/70">
                    Warm connectors to start with
                  </h2>
                  <FeedList
                    rows={connectors.slice(0, 5)}
                    voteFor={voteFor}
                    onVote={onVoteRow}
                    renderGraph={renderGraph}
                  />
                </section>
              ) : null}
            </>
          )}
        </>
      )}
    </div>
  );
}

// The truthful staged empty states. Which one shows depends on where the
// pipeline actually is — and "No people yet" NEVER renders when persons exist.
// Every state also offers the add-targets affordance, so a user with no
// network yet can seed specific people to reach directly.
function EmptyFeed({
  status,
}: {
  status: FunctionReturnType<typeof api.feed.status> | undefined;
}) {
  if (!status)
    return (
      <p className="py-16 text-center text-sm text-muted-foreground">
        Loading your network…
      </p>
    );
  return (
    <div className="py-10">
      {!status.hasPersons ? (
        <div className="text-center">
          <p className="text-sm text-muted-foreground">
            {status.hasSources
              ? "A source is connected but no contacts have been imported from it yet"
              : "No sources connected yet. Import your network to build your feed"}
          </p>
          <Button variant="primary" asChild className="mt-4">
            <Link href="/connectors">Connect a source</Link>
          </Button>
        </div>
      ) : (
        <p className="text-center text-sm text-muted-foreground">
          {status.embedCapped
            ? "Your network is imported, but today's ranking budget is used up. Ranking resumes tomorrow"
            : "Your network is imported but not yet ranked against your goal. Ranking runs after an import and with the daily refresh"}
        </p>
      )}
      <div className="mx-auto mt-8 max-w-md">
        <AddTargets />
      </div>
    </div>
  );
}

// The in-network reconnect rows, collapsed by default so the headline stays
// the new people to reach. Expanding reveals the full FeedList (voting, graph).
function ReconnectSection({
  count,
  children,
}: {
  count: number;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <section className="mt-8">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center justify-between rounded-xl border border-border bg-card px-4 py-3 text-left transition-colors hover:border-ring/40"
      >
        <span className="text-sm font-medium text-foreground">
          Reconnect with your network
          <span className="ml-1.5 text-muted-foreground">({count})</span>
        </span>
        {open ? (
          <ChevronUpIcon className="size-4 text-muted-foreground" aria-hidden />
        ) : (
          <ChevronDownIcon
            className="size-4 text-muted-foreground"
            aria-hidden
          />
        )}
      </button>
      {open ? <div className="mt-3">{children}</div> : null}
    </section>
  );
}

// Zero-lead call to action: the three ways to put real people into the feed.
function ZeroLeadCTA() {
  return (
    <div className="rounded-2xl border border-border bg-card p-6 [box-shadow:var(--shadow-s)]">
      <h2 className="text-[15px] font-semibold text-foreground">
        No target people yet
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Your feed fills with people once you tell it who you want to meet. Three
        ways to start:
      </p>
      <div className="mt-4">
        <AddTargets />
      </div>
      <div className="mt-4 flex flex-wrap gap-2.5">
        <Button variant="outline" asChild>
          <Link href="/goals">Add target companies</Link>
        </Button>
        <Button variant="outline" asChild>
          <Link href="/connectors">Install the Chrome extension</Link>
        </Button>
      </div>
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
  return <WarmGraph data={data} />;
}
