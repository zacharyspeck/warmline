"use client";

import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { CheckIcon } from "@/components/icons";

// Per-company results of "discover real people at my target companies" (the
// discovery run scheduled when a goal with target companies is saved). Honest
// about every company: how many people were added, or that no team page was
// found — nothing fails silently. Renders nothing until there is something to
// report.
export function DiscoveryNotes() {
  const notes = useQuery(api.discover.notesForGoal, {});
  if (!notes || notes.length === 0) return null;

  return (
    <div className="mt-6 rounded-2xl border border-border bg-card p-6 [box-shadow:var(--shadow-s)]">
      <h2 className="text-sm font-medium text-foreground">
        People found at your target companies
      </h2>
      <p className="mt-1 text-xs text-muted-foreground">
        We read each company&rsquo;s public team page once when you saved this
        goal
      </p>
      <ul className="mt-4 flex flex-col gap-2.5">
        {notes.map((n) => (
          <li
            key={n.company}
            className="flex items-start gap-3 rounded-lg border border-border bg-background/40 px-3 py-2.5"
          >
            <span
              className={
                "mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold " +
                (n.status === "found"
                  ? "bg-[oklch(0.92_0.06_150)] text-[oklch(0.42_0.11_152)]"
                  : "bg-muted text-muted-foreground")
              }
              aria-hidden
            >
              {n.status === "found" ? (
                <CheckIcon className="size-3" />
              ) : (
                "·"
              )}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-foreground">
                {n.company}
              </p>
              <p className="text-xs text-muted-foreground">{n.note}</p>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
