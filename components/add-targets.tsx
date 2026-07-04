"use client";

import { useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

type Row = { name: string; company?: string; linkedinUrl?: string };

// Parse a pasted list, one target per line: "Name, Company, linkedin-url".
// Company and URL are optional; a part that looks like a link is taken as the
// LinkedIn URL, the first other part as the company.
export function parseTargetList(text: string): Row[] {
  const rows: Row[] = [];
  for (const line of text.split(/\r?\n/)) {
    const parts = line.split(",").map((s) => s.trim());
    const name = parts[0];
    if (!name) continue;
    const row: Row = { name };
    for (const p of parts.slice(1)) {
      if (!p) continue;
      if (/linkedin\.com|\/in\/|^https?:\/\//i.test(p)) {
        row.linkedinUrl = p;
      } else if (!row.company) {
        row.company = p;
      }
    }
    rows.push(row);
  }
  return rows;
}

// Add specific target people (task S1.2). Rendered on the Goals surface and in
// the feed's empty area. Single add or pasted list; both call
// api.ingest.addTargets, which promotes an existing person to a lead rather
// than duplicating and then re-ranks.
export function AddTargets() {
  const addTargets = useMutation(api.ingest.addTargets);
  const [mode, setMode] = useState<"one" | "list">("one");
  const [name, setName] = useState("");
  const [company, setCompany] = useState("");
  const [linkedinUrl, setLinkedinUrl] = useState("");
  const [list, setList] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function submit(rows: Row[]) {
    if (rows.length === 0) {
      setError("Add at least a name");
      return;
    }
    if (rows.length > 100) {
      setError("Add up to 100 at a time");
      return;
    }
    setBusy(true);
    setError(null);
    setStatus(null);
    try {
      const res = await addTargets({ rows });
      const bits: string[] = [];
      if (res.added) bits.push(`${res.added} added`);
      if (res.promoted)
        bits.push(`${res.promoted} already in your network, promoted to leads`);
      setStatus(
        bits.length
          ? `${bits.join(" · ")}. Finding warm paths now…`
          : "Nothing to add",
      );
      setName("");
      setCompany("");
      setLinkedinUrl("");
      setList("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not add targets");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-5 text-left [box-shadow:var(--shadow-s)]">
      <div>
        <h2 className="text-sm font-semibold text-foreground">
          Add specific people to reach
        </h2>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Name a person you want to meet. If they are already in your network
          we promote them to a lead and find your warm path
        </p>
      </div>

      <div className="inline-flex w-fit gap-1 rounded-lg border border-border bg-background/50 p-0.5 text-xs">
        <button
          type="button"
          onClick={() => setMode("one")}
          aria-pressed={mode === "one"}
          className={
            mode === "one"
              ? "rounded-md bg-primary/15 px-2.5 py-1 font-medium text-primary"
              : "rounded-md px-2.5 py-1 text-muted-foreground hover:text-foreground"
          }
        >
          Add one
        </button>
        <button
          type="button"
          onClick={() => setMode("list")}
          aria-pressed={mode === "list"}
          className={
            mode === "list"
              ? "rounded-md bg-primary/15 px-2.5 py-1 font-medium text-primary"
              : "rounded-md px-2.5 py-1 text-muted-foreground hover:text-foreground"
          }
        >
          Paste a list
        </button>
      </div>

      {mode === "one" ? (
        <form
          className="flex flex-col gap-2.5"
          onSubmit={(e) => {
            e.preventDefault();
            void submit([
              {
                name: name.trim(),
                company: company.trim() || undefined,
                linkedinUrl: linkedinUrl.trim() || undefined,
              },
            ].filter((r) => r.name));
          }}
        >
          <Input
            aria-label="Name"
            placeholder="Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <Input
            aria-label="Company"
            placeholder="Company (optional)"
            value={company}
            onChange={(e) => setCompany(e.target.value)}
          />
          <Input
            aria-label="LinkedIn URL"
            placeholder="LinkedIn URL (optional)"
            value={linkedinUrl}
            onChange={(e) => setLinkedinUrl(e.target.value)}
          />
          <Button
            type="submit"
            variant="primary"
            className="self-start"
            disabled={busy || !name.trim()}
          >
            {busy ? "Adding…" : "Add target"}
          </Button>
        </form>
      ) : (
        <form
          className="flex flex-col gap-2.5"
          onSubmit={(e) => {
            e.preventDefault();
            void submit(parseTargetList(list));
          }}
        >
          <Textarea
            aria-label="Target list"
            rows={4}
            placeholder={"One per line:\nJane Doe, Acme, https://linkedin.com/in/jane\nSam Lee, Globex"}
            value={list}
            onChange={(e) => setList(e.target.value)}
          />
          <Button
            type="submit"
            variant="primary"
            className="self-start"
            disabled={busy || !list.trim()}
          >
            {busy ? "Adding…" : "Add targets"}
          </Button>
        </form>
      )}

      {status && <p className="text-xs text-primary">{status}</p>}
      {error && <p className="text-xs text-[oklch(0.78_0.14_22)]">{error}</p>}
    </div>
  );
}
