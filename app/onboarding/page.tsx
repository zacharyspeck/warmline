"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAction, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  ThinkingStep,
  ThinkingSteps,
  type StepStatus,
} from "@/components/ui/thinking-steps";
import { cn } from "@/lib/utils";
import { WarmlineMark } from "@/components/warmline-mark";
import { ConnectorsSurface } from "@/components/connectors-surface";

const PROCESSING_STEPS = [
  "Reading your product site",
  "Deriving your ICP",
  "Scanning your network",
  "Finding warm paths",
  "Ranking & drafting openers",
];

// Onboarding is goal, then connect: audience → product → processing (the
// goal is derived and saved here) → connect your network (the same surface
// as /connectors, skippable) → the feed.
export default function Onboarding() {
  const router = useRouter();
  // Non-null when the user has already onboarded: re-running the wizard
  // builds a NEW goal and feed on completion, so returning visitors get an
  // exit and a plain warning instead of a silent reset.
  const existingIcp = useQuery(api.icp.latest, {});
  const generate = useAction(api.onboard.generate);

  const [phase, setPhase] = useState<
    "audience" | "product" | "processing" | "connect"
  >("audience");
  const [audience, setAudience] = useState<"individual" | "company">("company");
  const [website, setWebsite] = useState("");
  const [linkedin, setLinkedin] = useState("");
  const [x, setX] = useState("");

  const [step, setStep] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [processError, setProcessError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const elapsedTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => () => {
    if (timer.current) clearInterval(timer.current);
    if (elapsedTimer.current) clearInterval(elapsedTimer.current);
  }, []);

  async function startProcessing() {
    setPhase("processing");
    setProcessError(null);
    setStep(0);
    setElapsed(0);
    timer.current = setInterval(() => {
      setStep((s) => {
        const next = Math.min(s + 1, PROCESSING_STEPS.length - 1);
        if (next === PROCESSING_STEPS.length - 1 && s !== next) {
          setElapsed(0);
          elapsedTimer.current = setInterval(() => setElapsed((e) => e + 1), 1000);
        }
        return next;
      });
    }, 3500);
    try {
      await generate({
        website: website || undefined,
        linkedin: linkedin || undefined,
        x: x || undefined,
        audience,
      });
      setStep(PROCESSING_STEPS.length);
      setTimeout(() => setPhase("connect"), 1200);
    } catch (e) {
      setProcessError(e instanceof Error ? e.message : "Something went wrong");
      setPhase("product");
    } finally {
      if (timer.current) clearInterval(timer.current);
      if (elapsedTimer.current) clearInterval(elapsedTimer.current);
    }
  }

  function stepStatus(i: number): StepStatus {
    if (step > i) return "complete";
    if (step === i) return "active";
    return "pending";
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background px-6 py-12">
      <div className={phase === "connect" ? "w-full max-w-2xl" : "w-full max-w-md"}>
        {existingIcp && phase !== "processing" && (
          <div className="mb-4 flex justify-end">
            <Link
              href="/"
              className="text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              Back to your feed
            </Link>
          </div>
        )}
        {/* S2 header: the small amber W with step dashes beneath it. */}
        <div className="mb-8 flex flex-col items-center gap-3">
          <WarmlineMark className="size-6 text-primary" />
          {phase !== "processing" && (
            <div className="flex items-center gap-1.5" aria-hidden>
              {(["audience", "product", "connect"] as const).map((p, i) => (
                <span
                  key={p}
                  className={cn(
                    "h-[3px] w-7 rounded-full transition-colors",
                    (phase === "audience" ? 0 : phase === "product" ? 1 : 2) >=
                      i
                      ? "bg-primary"
                      : "bg-border",
                  )}
                />
              ))}
            </div>
          )}
        </div>
        {/* Only before the goal is rebuilt — once generate ran, the fresh
            goal exists and the warning would be stale (and would wrongly
            show for brand-new accounts on the connect step). */}
        {existingIcp && (phase === "audience" || phase === "product") && (
          <p className="mb-6 rounded-lg border border-border bg-card px-3 py-2 text-center text-xs text-muted-foreground">
            You already have a goal and feed. Finishing this flow replaces
            them with a fresh goal and re-ranks from scratch
          </p>
        )}

        {phase === "audience" && (
          <AudienceStep
            value={audience}
            onChange={setAudience}
            onNext={() => setPhase("product")}
          />
        )}

        {phase === "product" && (
          <>
            <ProductStep
              audience={audience}
              website={website}
              linkedin={linkedin}
              x={x}
              onWebsite={setWebsite}
              onLinkedin={setLinkedin}
              onX={setX}
              onNext={() => void startProcessing()}
            />
            {processError && (
              <p className="mt-3 text-center text-sm text-destructive-foreground">
                {processError}
              </p>
            )}
          </>
        )}

        {phase === "processing" && (
          <div className="rounded-xl border border-border bg-card p-5 [box-shadow:var(--shadow-s)]">
            <p className="mb-4 text-sm font-medium text-foreground">Building your goal…</p>
            <ThinkingSteps>
              {PROCESSING_STEPS.map((title, i) => (
                <ThinkingStep
                  key={title}
                  title={title}
                  status={stepStatus(i)}
                  showConnector={i < PROCESSING_STEPS.length - 1}
                  description={
                    i === PROCESSING_STEPS.length - 1 && step === PROCESSING_STEPS.length - 1
                      ? elapsed < 5
                        ? "Scoring your network against your ICP…"
                        : `Still working, embedding takes about 1 to 2 min (${elapsed}s)`
                      : undefined
                  }
                />
              ))}
            </ThinkingSteps>
            {step >= PROCESSING_STEPS.length && (
              <p className="mt-3 text-sm font-medium text-foreground">Goal set. Next: connect your network…</p>
            )}
          </div>
        )}

        {phase === "connect" && (
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Connect your network</h1>
            <p className="mt-1.5 text-sm text-muted-foreground">
              The more contacts you add, the warmer your paths. Your feed ranks
              whatever you connect
            </p>

            <div className="mt-6">
              <ConnectorsSurface />
            </div>

            <div className="mt-6 flex flex-col gap-2">
              <Button
                onClick={() => router.push("/")}
                variant="primary"
                className="h-11 w-full"
              >
                Continue to your feed
              </Button>
              <button
                type="button"
                onClick={() => router.push("/")}
                className="py-1 text-center text-xs text-muted-foreground transition-colors hover:text-foreground"
              >
                Skip for now, you can connect sources any time from Connectors
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function AudienceStep({
  value,
  onChange,
  onNext,
}: {
  value: "individual" | "company";
  onChange: (v: "individual" | "company") => void;
  onNext: () => void;
}) {
  const options: {
    id: "individual" | "company";
    title: string;
    blurb: string;
  }[] = [
    {
      id: "individual",
      title: "Individual",
      blurb: "Founder, investor, or operator building your own network",
    },
    {
      id: "company",
      title: "Company or growth team",
      blurb: "Reach customers, partners, or hires on behalf of your company",
    },
  ];
  return (
    <div className="rounded-2xl border border-border bg-card px-7 py-9 [box-shadow:var(--shadow-s)]">
      <h1 className="text-center font-display text-2xl font-semibold tracking-tight text-foreground">
        Who are you setting
        <br />
        up Warmline for?
      </h1>
      <p className="mt-2 text-center text-sm text-muted-foreground">
        This tunes how we rank people for you
      </p>
      <div className="mt-7 flex flex-col gap-2.5">
        {options.map((o) => {
          const selected = value === o.id;
          return (
            <button
              key={o.id}
              type="button"
              onClick={() => onChange(o.id)}
              aria-pressed={selected}
              className={cn(
                "flex items-start justify-between gap-3 rounded-xl border bg-background/40 p-4 text-left transition-colors",
                selected
                  ? "border-primary ring-1 ring-primary"
                  : "border-border hover:border-ring/40",
              )}
            >
              <span>
                <span className="block text-sm font-medium text-foreground">
                  {o.title}
                </span>
                <span className="mt-0.5 block text-xs text-muted-foreground">
                  {o.blurb}
                </span>
              </span>
              <span
                aria-hidden
                className={cn(
                  "mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border",
                  selected ? "border-primary" : "border-muted-foreground/40",
                )}
              >
                {selected && (
                  <span className="size-2 rounded-full bg-primary" />
                )}
              </span>
            </button>
          );
        })}
        <Button onClick={onNext} variant="primary" className="mt-2 h-11 w-full">
          Continue
        </Button>
      </div>
    </div>
  );
}

function ProductStep({
  audience, website, linkedin, x,
  onWebsite, onLinkedin, onX, onNext,
}: {
  audience: "individual" | "company";
  website: string; linkedin: string; x: string;
  onWebsite: (v: string) => void; onLinkedin: (v: string) => void; onX: (v: string) => void;
  onNext: () => void;
}) {
  const individual = audience === "individual";
  return (
    <div className="rounded-2xl border border-border bg-card px-7 py-9 [box-shadow:var(--shadow-s)]">
      <h1 className="text-center font-display text-2xl font-semibold tracking-tight text-foreground">
        {individual ? "What are you working toward?" : "What do you sell?"}
      </h1>
      <p className="mx-auto mt-2 max-w-sm text-center text-sm text-muted-foreground">
        {individual
          ? "We read what you're building to learn who you should meet, then rank the people you know by who can help"
          : "We read your product to learn who you're selling to, then rank the people you know against it"}
      </p>
      <div className="mt-7 flex flex-col gap-4">
        <Field
          label={individual ? "Your site or portfolio" : "Product website"}
          value={website}
          onChange={onWebsite}
          placeholder={individual ? "https://your-site.com" : "https://your-product.com"}
          type="url"
          autoFocus
        />
        <Field label="Your LinkedIn" value={linkedin} onChange={onLinkedin} placeholder="https://linkedin.com/in/you" type="url" />
        <Field label="Your X" value={x} onChange={onX} placeholder="https://x.com/you" type="url" />
        <Button
          onClick={onNext}
          disabled={!website.trim()}
          variant="primary"
          className="mt-2 h-11 w-full"
        >
          Continue
        </Button>
        <p className="text-center text-xs text-muted-foreground">
          You can refine this any time
        </p>
      </div>
    </div>
  );
}

function Field({
  label, value, onChange, placeholder, type = "text", autoFocus,
}: {
  label: string; value: string; onChange: (v: string) => void;
  placeholder?: string; type?: string; autoFocus?: boolean;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label>{label}</Label>
      <Input type={type} placeholder={placeholder} value={value} onChange={(e) => onChange(e.target.value)} autoFocus={autoFocus} />
    </div>
  );
}
