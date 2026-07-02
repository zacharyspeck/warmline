"use client";

import { useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import type { FunctionReturnType } from "convex/server";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import {
  KeyIcon,
  Link2Icon,
  ThumbsDownIcon,
  ThumbsUpIcon,
} from "@/components/icons";
import { LinkedinIcon, XIcon } from "@/components/icons/brand";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { AvatarGroup } from "@/components/ui/avatar-group";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

// The feed as a card list (S3), shared by the signed-in feed
// (components/home-feed.tsx, api.feed.list) and the logged-out demo
// (components/demo-feed.tsx, api.demo.feed — same row validator). Each card
// reads left→right: who (photo, name, role, socials), why they fit, how to
// reach (warm-path chip + angle), mutual connections, and the amber relevance
// number. Thumbs on every card. Data fetching, voting, and the graph query
// stay with the caller: votes arrive via onVote (the demo prompts sign-up
// instead of writing) and the expanded panel via renderGraph.

export type FeedRow = FunctionReturnType<typeof api.feed.list>[number];

function linkedinHref(slug?: string) {
  return slug ? `https://www.linkedin.com/in/${slug}` : undefined;
}
function xHref(handle?: string) {
  return handle ? `https://x.com/${handle.replace(/^@/, "")}` : undefined;
}

// S4 motion spec, "one vote, one turn of the wheel":
//   1. Pivot off the top — the voted card rotates back over the top edge and
//      fades: translateY(-52px) rotateX(-78°), opacity 1 → 0, 500ms,
//      cubic-bezier(.34,.03,.22,1), perspective 1150px, origin top.
//   2. Feed eases up — every card below slides up one slot on the same curve.
//   3. Next rolls in — the voted card re-enters at the bottom of the list.
// The vote itself commits when the pivot completes (the caller then demotes
// the row, which reorders `rows`). prefers-reduced-motion skips the theater
// and votes instantly.
const WHEEL_EASE: [number, number, number, number] = [0.34, 0.03, 0.22, 1];
const WHEEL_MS = 0.5;

export function FeedList({
  rows,
  voteFor,
  onVote,
  renderGraph,
  voteMotion = true,
}: {
  rows: FeedRow[];
  voteFor: ReadonlyMap<Id<"persons">, "up" | "down">;
  onVote: (personId: Id<"persons">, vote: "up" | "down") => void;
  renderGraph: (personId: Id<"persons">) => React.ReactNode;
  // The demo feed passes false: its thumbs open a sign-up prompt and nothing
  // cycles, so the card must not pivot away.
  voteMotion?: boolean;
}) {
  const [expanded, setExpanded] = useState<Id<"persons"> | null>(null);
  const [pending, setPending] = useState<{
    id: Id<"persons">;
    vote: "up" | "down";
  } | null>(null);
  const reduceMotion = useReducedMotion();

  return (
    <TooltipProvider delayDuration={150}>
      <div className="flex flex-col gap-3" style={{ perspective: 1150 }}>
        {rows.map((row) => (
          <FeedCard
            key={row.id}
            row={row}
            currentVote={voteFor.get(row.id)}
            expanded={expanded === row.id}
            exiting={pending?.id === row.id}
            onToggle={() =>
              setExpanded((cur) => (cur === row.id ? null : row.id))
            }
            onVote={(v) => {
              if (pending) return; // one turn of the wheel at a time
              // A vote closes the card's panel: the card is about to cycle
              // away, and its open panel must not be left behind.
              setExpanded((cur) => (cur === row.id ? null : cur));
              if (!voteMotion || reduceMotion) {
                onVote(row.id, v);
                return;
              }
              setPending({ id: row.id, vote: v });
            }}
            onExitComplete={() => {
              if (pending) {
                onVote(pending.id, pending.vote);
                setPending(null);
              }
            }}
            renderGraph={renderGraph}
          />
        ))}
      </div>
    </TooltipProvider>
  );
}

function SocialLink({
  href,
  children,
  label,
}: {
  href?: string;
  children: React.ReactNode;
  label: string;
}) {
  if (!href) return null;
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={label}
      onClick={(e) => e.stopPropagation()}
      className="text-muted-foreground transition-colors hover:text-foreground"
    >
      {children}
    </a>
  );
}

function FeedCard({
  row,
  currentVote,
  expanded,
  exiting,
  onToggle,
  onVote,
  onExitComplete,
  renderGraph,
}: {
  row: FeedRow;
  currentVote?: "up" | "down";
  expanded: boolean;
  exiting: boolean;
  onToggle: () => void;
  onVote: (v: "up" | "down") => void;
  onExitComplete: () => void;
  renderGraph: (personId: Id<"persons">) => React.ReactNode;
}) {
  const reduceMotion = useReducedMotion();
  const sub = [row.role, row.company].filter(Boolean).join(" · ");
  return (
    <motion.article
      layout="position"
      animate={
        exiting
          ? { y: -52, rotateX: -78, opacity: 0 }
          : { y: 0, rotateX: 0, opacity: 1 }
      }
      transition={
        reduceMotion
          ? { duration: 0 }
          : { duration: WHEEL_MS, ease: WHEEL_EASE }
      }
      style={{ transformOrigin: "top", transformPerspective: 1150 }}
      onAnimationComplete={() => {
        if (exiting) onExitComplete();
      }}
      onClick={onToggle}
      className={cn(
        "cursor-pointer rounded-xl border bg-card p-5 [box-shadow:var(--shadow-s)] transition-colors",
        currentVote
          ? "border-border border-l-2 border-l-primary"
          : "border-border hover:border-ring/40",
      )}
    >
      <div className="flex items-start gap-4">
        <Avatar className="mt-0.5 size-12">
          {row.avatarUrl ? <AvatarImage src={row.avatarUrl} alt="" /> : null}
          <AvatarFallback>{row.initials}</AvatarFallback>
        </Avatar>

        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="truncate text-[15px] font-semibold text-foreground">
                  {row.name}
                </span>
                <SocialLink
                  href={linkedinHref(row.linkedinUrl)}
                  label={`${row.name} on LinkedIn`}
                >
                  <LinkedinIcon role="img" className="size-3.5 shrink-0" />
                </SocialLink>
                <SocialLink href={xHref(row.xHandle)} label={`${row.name} on X`}>
                  <XIcon role="img" className="size-3 shrink-0" />
                </SocialLink>
                {row.gatekeeper && (
                  <Badge variant="warning" className="gap-1">
                    <KeyIcon className="size-3" /> Key
                  </Badge>
                )}
                {row.unlocks ? (
                  <Badge variant="outline">unlocks {row.unlocks}</Badge>
                ) : null}
              </div>
              {sub && (
                <p className="mt-0.5 truncate text-[13px] text-muted-foreground">
                  {sub}
                </p>
              )}
            </div>

            <div className="shrink-0 text-right">
              <span className="text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground/60">
                Relevance
              </span>
              <div className="font-display text-[22px] font-semibold leading-tight text-foreground">
                {row.score}
              </div>
              <div
                className="ml-auto mt-1 h-[3px] w-20 overflow-hidden rounded-full bg-muted"
                aria-hidden
              >
                <div
                  className="h-full rounded-full bg-primary"
                  style={{ width: `${Math.max(0, Math.min(100, row.score))}%` }}
                />
              </div>
            </div>
          </div>

          {row.why.length > 0 && (
            <div className="mt-2.5 space-y-1">
              {row.why.slice(0, 3).map((b, i) => (
                <p
                  key={i}
                  className={cn(
                    "text-[13.5px] leading-snug",
                    i === 0 ? "text-secondary-foreground" : "text-muted-foreground",
                  )}
                >
                  {b.text}
                </p>
              ))}
            </div>
          )}

          <div className="mt-3 flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
            <span className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-border bg-background/50 px-2.5 py-1 text-xs">
              <Link2Icon className="size-3 shrink-0 text-primary" aria-hidden />
              {row.mutuals.length > 0 ? (
                <>
                  <span className="font-medium text-foreground">Warm intro</span>
                  <span className="text-muted-foreground">via</span>
                  <span className="truncate font-medium text-foreground">
                    {row.mutuals[0].name}
                  </span>
                </>
              ) : (
                <span className="font-medium text-foreground">
                  {row.kind === "connector" ? "Warm connector" : "Direct outreach"}
                </span>
              )}
            </span>
            {row.how[0] && (
              <span className="min-w-0 truncate text-xs text-muted-foreground">
                {row.how[0]}
              </span>
            )}
          </div>

          <div className="mt-3.5 flex items-end justify-between gap-3">
            {row.mutuals.length > 0 ? (
              <div className="flex items-center gap-1.5">
                <AvatarGroup max={3}>
                  {row.mutuals.map((m) => (
                    <Tooltip key={m.name}>
                      <TooltipTrigger asChild>
                        <Avatar className="size-6 ring-2 ring-card">
                          <AvatarFallback className="text-[9px]">
                            {m.initials}
                          </AvatarFallback>
                        </Avatar>
                      </TooltipTrigger>
                      <TooltipContent>{m.name}</TooltipContent>
                    </Tooltip>
                  ))}
                </AvatarGroup>
                <span className="text-xs tabular-nums text-muted-foreground">
                  {row.mutualsTotal} mutual connection
                  {row.mutualsTotal === 1 ? "" : "s"}
                </span>
              </div>
            ) : (
              <span className="text-xs text-muted-foreground/40">
                No warm path yet
              </span>
            )}

            <div
              className="flex flex-col items-end gap-1"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="inline-flex gap-1">
                <Button
                  variant="ghost"
                  size="icon"
                  className={cn(
                    "size-8 rounded-lg border",
                    currentVote === "up"
                      ? "border-primary bg-primary/15 text-primary hover:text-primary"
                      : "border-border text-muted-foreground hover:border-ring/50",
                  )}
                  aria-label="Good, more like this"
                  aria-pressed={currentVote === "up"}
                  onClick={() => onVote("up")}
                >
                  <ThumbsUpIcon className="size-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className={cn(
                    "size-8 rounded-lg border",
                    currentVote === "down"
                      ? "border-primary bg-primary/15 text-primary hover:text-primary"
                      : "border-border text-muted-foreground hover:border-ring/50",
                  )}
                  aria-label="Bad, fewer like this"
                  aria-pressed={currentVote === "down"}
                  onClick={() => onVote("down")}
                >
                  <ThumbsDownIcon className="size-4" />
                </Button>
              </div>
              {currentVote && (
                <span className="text-[10px] font-medium text-primary">
                  {currentVote === "up" ? "More like this" : "Fewer like this"}
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      {expanded && (
        // S6: the expanded person view — the warm path on top, then why they
        // fit beside the drafted opener.
        <div
          className="mt-4 border-t border-border pt-4"
          onClick={(e) => e.stopPropagation()}
        >
          {renderGraph(row.id)}
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <div>
              <p className="text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground/60">
                Why {row.name.split(/\s+/)[0]} fits
              </p>
              <ul className="mt-2.5 space-y-2">
                {row.why.map((b, i) => (
                  <li
                    key={i}
                    className="flex items-start gap-2 text-[13.5px] leading-snug text-secondary-foreground"
                  >
                    <span
                      className="mt-1.5 size-1.5 shrink-0 rounded-full bg-primary"
                      aria-hidden
                    />
                    {b.text}
                  </li>
                ))}
              </ul>
            </div>
            {row.opener ? <OpenerCard opener={row.opener} /> : null}
          </div>
        </div>
      )}
    </motion.article>
  );
}

function OpenerCard({ opener }: { opener: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex flex-col rounded-xl border border-border bg-background/40 p-4">
      <p className="text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground/60">
        Drafted opener
      </p>
      <p className="mt-2 flex-1 text-sm leading-relaxed text-foreground">
        &ldquo;{opener}&rdquo;
      </p>
      <Button
        variant="primary"
        size="sm"
        className="mt-3 self-start"
        onClick={() => {
          void navigator.clipboard.writeText(opener).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1600);
          });
        }}
      >
        {copied ? "Copied" : "Copy opener"}
      </Button>
    </div>
  );
}
