"use client";

import { useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import type { FunctionReturnType } from "convex/server";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { KeyIcon, ThumbsDownIcon, ThumbsUpIcon } from "@/components/icons";
import { LinkedinIcon, XIcon } from "@/components/icons/brand";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { AvatarGroup } from "@/components/ui/avatar-group";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

// The presentational feed table, shared by the signed-in feed
// (components/home-feed.tsx, api.feed.list) and the logged-out demo
// (components/demo-feed.tsx, api.demo.feed — same row validator). Data
// fetching, voting, and the graph query stay with the caller: votes arrive via
// onVote (the demo prompts sign-up instead of writing) and the expanded warm
// graph via renderGraph (api.graph vs api.demo).

export type FeedRow = FunctionReturnType<typeof api.feed.list>[number];
type Confidence = "high" | "medium" | "low";

const DOT: Record<Confidence, string> = {
  high: "bg-[oklch(0.82_0.11_165)]",
  medium: "bg-[oklch(0.85_0.1_85)]",
  low: "bg-[oklch(0.7_0.16_25)]",
};

function linkedinHref(slug?: string) {
  return slug ? `https://www.linkedin.com/in/${slug}` : undefined;
}
function xHref(handle?: string) {
  return handle ? `https://x.com/${handle.replace(/^@/, "")}` : undefined;
}

// The vote wheel: rows are motion rows keyed by person id, so when the caller
// reorders `rows` (a vote cycles a row toward the bottom, home-feed.tsx) each
// row FLIP-animates from its old slot to its new one. Subtle and quick
// (spring, ~350ms), and prefers-reduced-motion collapses it to an instant
// move. Ranking itself is untouched; the real re-rank stays on the daily run.
const MotionTableRow = motion.create(TableRow);

export function FeedTable({
  rows,
  voteFor,
  onVote,
  renderGraph,
}: {
  rows: FeedRow[];
  voteFor: ReadonlyMap<Id<"persons">, "up" | "down">;
  onVote: (personId: Id<"persons">, vote: "up" | "down") => void;
  renderGraph: (personId: Id<"persons">) => React.ReactNode;
}) {
  const [expanded, setExpanded] = useState<Id<"persons"> | null>(null);
  return (
    <TooltipProvider delayDuration={150}>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-[210px]">Person</TableHead>
            <TableHead className="w-[104px]">Relevance</TableHead>
            <TableHead className="min-w-[300px]">Why</TableHead>
            <TableHead className="min-w-[240px]">How</TableHead>
            <TableHead className="w-[100px]">Mutuals</TableHead>
            <TableHead className="w-[88px] text-right">Feedback</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <FeedRowView
              key={row.id}
              row={row}
              currentVote={voteFor.get(row.id)}
              expanded={expanded === row.id}
              onToggle={() =>
                setExpanded((cur) => (cur === row.id ? null : row.id))
              }
              onVote={(v) => {
                // A vote closes the row's accordion: the row is about to
                // cycle away, and its open panel must not be left behind.
                setExpanded((cur) => (cur === row.id ? null : cur));
                onVote(row.id, v === "good" ? "up" : "down");
              }}
              renderGraph={renderGraph}
            />
          ))}
        </TableBody>
      </Table>
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
  if (!href)
    return (
      <span className="text-muted-foreground/40" aria-hidden>
        {children}
      </span>
    );
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

function FeedRowView({
  row,
  currentVote,
  expanded,
  onToggle,
  onVote,
  renderGraph,
}: {
  row: FeedRow;
  currentVote?: "up" | "down";
  expanded: boolean;
  onToggle: () => void;
  onVote: (v: "good" | "bad") => void;
  renderGraph: (personId: Id<"persons">) => React.ReactNode;
}) {
  const reduceMotion = useReducedMotion();
  return (
    <>
      <MotionTableRow
        layout="position"
        transition={
          reduceMotion
            ? { duration: 0 }
            : { type: "spring", duration: 0.35, bounce: 0.15 }
        }
        className="cursor-pointer"
        onClick={onToggle}
      >
        {/* Person */}
        <TableCell className="align-top">
          <div className="flex items-start gap-3">
            <Avatar className="mt-0.5">
              {row.avatarUrl ? <AvatarImage src={row.avatarUrl} alt="" /> : null}
              <AvatarFallback>{row.initials}</AvatarFallback>
            </Avatar>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="truncate font-medium">{row.name}</span>
                <SocialLink
                  href={linkedinHref(row.linkedinUrl)}
                  label={`${row.name} on LinkedIn`}
                >
                  <LinkedinIcon role="img" className="size-3.5 shrink-0" />
                </SocialLink>
                <SocialLink
                  href={xHref(row.xHandle)}
                  label={`${row.name} on X`}
                >
                  <XIcon role="img" className="size-3 shrink-0" />
                </SocialLink>
              </div>
              <div className="truncate text-xs text-muted-foreground">
                {[row.company, row.role].filter(Boolean).join(" · ")}
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                {row.kind === "lead" ? (
                  <Badge variant="secondary">Lead</Badge>
                ) : (
                  <Badge variant="primary">Connector</Badge>
                )}
                {row.gatekeeper && (
                  <Badge variant="warning" className="gap-1">
                    <KeyIcon className="size-3" /> Key
                  </Badge>
                )}
                {row.unlocks ? (
                  <Badge variant="outline">unlocks {row.unlocks}</Badge>
                ) : null}
              </div>
            </div>
          </div>
        </TableCell>

        {/* Relevance — the ranker's 0–100 score, read straight from the row */}
        <TableCell className="align-top">
          <div
            className="flex items-center gap-2"
            title={`Relevance ${row.score} of 100`}
          >
            <span className="text-sm font-semibold tabular-nums text-foreground">
              {row.score}
            </span>
            <div
              className="h-1.5 w-10 overflow-hidden rounded-full bg-muted"
              aria-hidden
            >
              <div
                className="h-full rounded-full bg-primary"
                style={{
                  width: `${Math.max(0, Math.min(100, row.score))}%`,
                }}
              />
            </div>
          </div>
        </TableCell>

        {/* Why */}
        <TableCell className="align-top">
          <ul className="space-y-1.5">
            {row.why.map((b, i) => (
              <li key={i} className="flex items-start gap-2 text-[13px] leading-snug">
                <span
                  className={cn(
                    "mt-1.5 size-1.5 shrink-0 rounded-full",
                    DOT[b.confidence],
                  )}
                  aria-label={`${b.confidence} confidence`}
                />
                <span className="text-secondary-foreground">{b.text}</span>
              </li>
            ))}
          </ul>
        </TableCell>

        {/* How */}
        <TableCell className="align-top">
          <ul className="space-y-1">
            {row.how.map((b, i) => (
              <li key={i} className="flex items-start gap-1.5 text-[13px] leading-snug text-muted-foreground">
                <span className="mt-[3px] shrink-0 text-[9px] text-muted-foreground/50">●</span>
                <span>{b}</span>
              </li>
            ))}
          </ul>
        </TableCell>

        {/* Mutuals — warm path: bridging connectors for a lead, fan-out for a connector */}
        <TableCell className="align-top">
          {row.mutuals.length > 0 ? (
            <div className="flex items-center gap-1.5">
              <AvatarGroup max={3}>
                {row.mutuals.map((m) => (
                  <Tooltip key={m.name}>
                    <TooltipTrigger asChild>
                      <Avatar className="ring-2 ring-background">
                        <AvatarFallback className="text-[10px]">
                          {m.initials}
                        </AvatarFallback>
                      </Avatar>
                    </TooltipTrigger>
                    <TooltipContent>{m.name}</TooltipContent>
                  </Tooltip>
                ))}
              </AvatarGroup>
              {row.mutualsTotal > row.mutuals.length && (
                <span className="text-xs font-medium tabular-nums text-muted-foreground">
                  +{row.mutualsTotal - row.mutuals.length}
                </span>
              )}
            </div>
          ) : (
            <span className="text-xs text-muted-foreground/40">
              No warm path yet
            </span>
          )}
        </TableCell>

        {/* Feedback */}
        <TableCell
          className="align-top text-right"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="inline-flex gap-1">
            <Button
              variant="ghost"
              size="icon"
              className={cn(
                "size-8",
                currentVote === "up"
                  ? "bg-primary/15 text-primary hover:text-primary"
                  : "text-muted-foreground",
              )}
              aria-label="Good, more like this"
              aria-pressed={currentVote === "up"}
              onClick={() => onVote("good")}
            >
              <ThumbsUpIcon className="size-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className={cn(
                "size-8",
                currentVote === "down"
                  ? "bg-primary/15 text-primary hover:text-primary"
                  : "text-muted-foreground",
              )}
              aria-label="Bad, fewer like this"
              aria-pressed={currentVote === "down"}
              onClick={() => onVote("bad")}
            >
              <ThumbsDownIcon className="size-4" />
            </Button>
          </div>
        </TableCell>
      </MotionTableRow>

      {expanded && (
        // The accordion is a motion row with the SAME transition as its
        // parent, so when rows above reorder the pair translates together
        // instead of the panel snapping away from its row.
        <MotionTableRow
          layout="position"
          transition={
            reduceMotion
              ? { duration: 0 }
              : { type: "spring", duration: 0.35, bounce: 0.15 }
          }
        >
          <TableCell colSpan={6} className="bg-muted/10 p-3">
            {row.opener ? (
              <div className="mb-3 rounded-lg border border-border bg-card p-3 [box-shadow:var(--shadow-s)]">
                <div className="mb-1 text-xs font-medium text-muted-foreground">
                  Drafted opener
                </div>
                <p className="text-sm text-foreground">{row.opener}</p>
              </div>
            ) : null}
            {renderGraph(row.id)}
          </TableCell>
        </MotionTableRow>
      )}
    </>
  );
}
