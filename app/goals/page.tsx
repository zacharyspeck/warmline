"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAction, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { TagInput } from "@/components/tag-input";
import { AddTargets } from "@/components/add-targets";

type Targets = { companies: string[]; roles: string[]; locations: string[] };
const EMPTY: Targets = { companies: [], roles: [], locations: [] };

// The Goals editor (task S1.1): edit the free-text goal statement and the
// structured targets that steer ranking, save once (embeds + re-ranks), and
// land back on the feed. A full reset still runs the onboarding flow.
export default function Goals() {
  const router = useRouter();
  const icp = useQuery(api.icp.latest, {});
  const saveGoal = useAction(api.goals.saveGoal);

  const [text, setText] = useState("");
  const [targets, setTargets] = useState<Targets>(EMPTY);
  const [prefilledId, setPrefilledId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A signed-in user with no goal belongs in onboarding, not here.
  useEffect(() => {
    if (icp === null) router.replace("/onboarding");
  }, [icp, router]);

  // Prefill from the saved goal when it first loads (reset-during-render, so
  // no cascading effect). Keyed on the goal id: it only re-runs if the saved
  // goal id changes, which does not happen while editing.
  if (icp && icp._id !== prefilledId) {
    setPrefilledId(icp._id);
    setText(icp.text);
    setTargets(icp.targets ?? EMPTY);
  }

  const dirty = useMemo(() => {
    if (!icp) return false;
    const t = icp.targets ?? EMPTY;
    return (
      text.trim() !== icp.text ||
      JSON.stringify(targets) !== JSON.stringify(t)
    );
  }, [icp, text, targets]);

  if (icp === undefined) {
    return (
      <div className="mx-auto w-full max-w-2xl px-6 py-10">
        <p className="py-16 text-center text-sm text-muted-foreground">
          Loading your goal…
        </p>
      </div>
    );
  }
  if (icp === null) return null; // redirecting to onboarding

  async function onSave() {
    if (!text.trim()) {
      setError("Add a goal statement first");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await saveGoal({ text: text.trim(), targets });
      router.push("/");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save your goal");
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-2xl px-6 py-10">
      <header className="mb-7">
        <h1 className="font-display text-[28px] font-semibold tracking-tight text-foreground">
          Your goal
        </h1>
        <p className="mt-1.5 text-sm text-muted-foreground">
          This is what your feed ranks people against. Edit it any time; saving
          re-ranks your network
        </p>
      </header>

      <div className="flex flex-col gap-6 rounded-2xl border border-border bg-card p-6 [box-shadow:var(--shadow-s)]">
        <div className="flex flex-col gap-1.5">
          <label
            htmlFor="goal-text"
            className="text-sm font-medium text-foreground"
          >
            Goal statement
          </label>
          <Textarea
            id="goal-text"
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={3}
            placeholder="e.g. Meet AI infrastructure founders raising a seed round"
          />
        </div>

        <TagInput
          id="target-companies"
          label="Target companies"
          values={targets.companies}
          onChange={(companies) => setTargets((t) => ({ ...t, companies }))}
          placeholder="Add a company and press Enter"
        />
        <TagInput
          id="target-roles"
          label="Target roles"
          values={targets.roles}
          onChange={(roles) => setTargets((t) => ({ ...t, roles }))}
          placeholder="Add a role and press Enter"
        />
        <TagInput
          id="target-locations"
          label="Locations (optional)"
          values={targets.locations}
          onChange={(locations) => setTargets((t) => ({ ...t, locations }))}
          placeholder="Add a location and press Enter"
        />

        {error && (
          <p className="text-sm text-[oklch(0.78_0.14_22)]">{error}</p>
        )}

        <div className="flex items-center gap-3">
          <Button
            variant="primary"
            onClick={() => void onSave()}
            disabled={busy || !text.trim() || !dirty}
          >
            {busy ? "Saving & re-ranking…" : "Save goal"}
          </Button>
          <Link
            href="/"
            className="text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            Back to your feed
          </Link>
        </div>
      </div>

      <div className="mt-6">
        <AddTargets />
      </div>

      <p className="mt-4 text-xs text-muted-foreground">
        Want to start over from your product site?{" "}
        <Link
          href="/onboarding"
          className="font-medium text-primary underline-offset-4 hover:underline"
        >
          Rebuild your goal
        </Link>
      </p>
    </div>
  );
}
