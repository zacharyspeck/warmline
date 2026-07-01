"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useAction, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  ThinkingStep,
  ThinkingSteps,
  type StepStatus,
} from "@/components/ui/thinking-steps";
import {
  CheckIcon,
  UploadIcon,
  DownloadIcon,
  FileTextIcon,
  ExternalLinkIcon,
} from "@/components/icons";
import {
  ChromeIcon,
  GoogleIcon,
  InstagramIcon,
  LinkedinIcon,
  LumaIcon,
  OutlookIcon,
  XIcon,
} from "@/components/icons/brand";
import { cn } from "@/lib/utils";
import { WarmlineLockup } from "@/components/warmline-mark";
import type { Provider } from "@/app/connectors/connectors-config";

const PROCESSING_STEPS = [
  "Reading your product site",
  "Deriving your ICP",
  "Scanning your network",
  "Finding warm paths",
  "Ranking & drafting openers",
];

type ConnectedMap = Partial<Record<Provider, boolean>>;

export default function Onboarding() {
  const router = useRouter();
  const generate = useAction(api.onboard.generate);
  const generateUploadUrl = useMutation(api.connectors.generateUploadUrl);
  const recordUpload = useMutation(api.connectors.recordUpload);
  const parseLinkedIn = useAction(api.linkedinImport.parseLinkedInExport);

  const [phase, setPhase] = useState<"product" | "connect" | "processing">("product");
  const [website, setWebsite] = useState("");
  const [linkedin, setLinkedin] = useState("");
  const [x, setX] = useState("");
  const [connected, setConnected] = useState<ConnectedMap>({});
  const [uploadBusy, setUploadBusy] = useState<Partial<Record<Provider, boolean>>>({});
  const [uploadError, setUploadError] = useState<string | null>(null);

  const [step, setStep] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [processError, setProcessError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const elapsedTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => () => {
    if (timer.current) clearInterval(timer.current);
    if (elapsedTimer.current) clearInterval(elapsedTimer.current);
  }, []);

  function markConnected(provider: Provider) {
    setConnected((c) => ({ ...c, [provider]: true }));
  }

  async function handleFileUpload(provider: Provider, file: File, parse?: boolean) {
    try {
      setUploadBusy((b) => ({ ...b, [provider]: true }));
      setUploadError(null);
      const url = await generateUploadUrl();
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": file.type || "application/octet-stream" },
        body: file,
      });
      if (!res.ok) throw new Error("Upload failed");
      const { storageId } = (await res.json()) as { storageId: Id<"_storage"> };
      await recordUpload({
        provider,
        method: "manual",
        label: `${provider} data`,
        fileName: file.name,
        storageId,
      });
      if (parse && provider === "linkedin") {
        await parseLinkedIn({ storageId });
      }
      markConnected(provider);
    } catch (e) {
      setUploadError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploadBusy((b) => ({ ...b, [provider]: false }));
    }
  }

  async function handleExtensionRecord() {
    await recordUpload({ provider: "extension", method: "extension", label: "Chrome extension" });
    markConnected("extension");
  }

  async function startProcessing() {
    setPhase("processing");
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
      });
      setStep(PROCESSING_STEPS.length);
      setTimeout(() => router.push("/"), 1400);
    } catch (e) {
      setProcessError(e instanceof Error ? e.message : "Something went wrong");
      setPhase("connect");
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
        <div className="mb-8">
          <WarmlineLockup markClassName="size-7" />
        </div>

        {phase === "product" && (
          <ProductStep
            website={website}
            linkedin={linkedin}
            x={x}
            onWebsite={setWebsite}
            onLinkedin={setLinkedin}
            onX={setX}
            onNext={() => setPhase("connect")}
          />
        )}

        {phase === "connect" && (
          <ConnectStep
            connected={connected}
            uploadBusy={uploadBusy}
            uploadError={uploadError}
            onFileUpload={handleFileUpload}
            onExtensionRecord={handleExtensionRecord}
            onBuild={startProcessing}
            error={processError}
          />
        )}

        {phase === "processing" && (
          <div className="rounded-xl border border-border bg-card p-5 [box-shadow:var(--shadow-s)]">
            <p className="mb-4 text-sm font-medium text-foreground">Building your warm network…</p>
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
                        : `Still working — embedding takes ~1–2 min (${elapsed}s)`
                      : undefined
                  }
                />
              ))}
            </ThinkingSteps>
            {step >= PROCESSING_STEPS.length && (
              <p className="mt-3 text-sm font-medium text-foreground">Done — opening your feed…</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function ProductStep({
  website, linkedin, x,
  onWebsite, onLinkedin, onX, onNext,
}: {
  website: string; linkedin: string; x: string;
  onWebsite: (v: string) => void; onLinkedin: (v: string) => void; onX: (v: string) => void;
  onNext: () => void;
}) {
  return (
    <div>
      <h1 className="text-xl font-semibold tracking-tight">What do you sell?</h1>
      <p className="mt-1.5 text-sm text-muted-foreground">
        We read your product to learn who you&apos;re selling to, then rank people you know against it.
      </p>
      <div className="mt-7 flex flex-col gap-4">
        <Field label="Product website" value={website} onChange={onWebsite} placeholder="https://your-product.com" type="url" autoFocus />
        <Field label="Your LinkedIn" value={linkedin} onChange={onLinkedin} placeholder="https://linkedin.com/in/you" type="url" />
        <Field label="Your X" value={x} onChange={onX} placeholder="https://x.com/you" type="url" />
        <Button onClick={onNext} disabled={!website.trim()} className="mt-1">
          Continue
        </Button>
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

function ConnectStep({
  connected, uploadBusy, uploadError,
  onFileUpload, onExtensionRecord, onBuild, error,
}: {
  connected: ConnectedMap;
  uploadBusy: Partial<Record<Provider, boolean>>;
  uploadError: string | null;
  onFileUpload: (p: Provider, f: File, parse?: boolean) => void;
  onExtensionRecord: () => void;
  onBuild: () => void;
  error: string | null;
}) {
  const connectedCount = Object.values(connected).filter(Boolean).length;

  return (
    <div>
      <h1 className="text-xl font-semibold tracking-tight">Connect your network</h1>
      <p className="mt-1.5 text-sm text-muted-foreground">
        The more contacts you add, the warmer your paths.
      </p>

      <div className="mt-6 grid grid-cols-2 gap-2.5">
        <div className="col-span-2">
          <ExtensionCard
            connected={!!connected.extension}
            onMark={onExtensionRecord}
          />
        </div>

        <OAuthCard
          Icon={GoogleIcon}
          name="Google"
          blurb="Contacts, calendar, and email headers."
          connected={!!connected.google}
          startUrl="/api/connectors/google"
        />

        <OAuthCard
          Icon={OutlookIcon}
          name="Outlook"
          blurb="Contacts from recent email activity."
          connected={!!connected.outlook}
          startUrl="/api/connectors/outlook"
        />

        <FileCard
          Icon={LinkedinIcon}
          name="LinkedIn"
          blurb="Import your connections export."
          connected={!!connected.linkedin}
          busy={!!uploadBusy.linkedin}
          accept=".zip,application/zip"
          acceptLabel="ZIP file"
          exportUrl="https://www.linkedin.com/mypreferences/d/download-my-data"
          guide={[
            { text: "Select Download larger data archive (top option).", warn: "Second option won't include connections." },
            { text: "Click Request archive — LinkedIn emails it in ~10 min." },
          ]}
          onFile={(f) => onFileUpload("linkedin", f, true)}
        />

        <FileCard
          Icon={XIcon}
          name="Twitter / X"
          blurb="Import your followers archive."
          connected={!!connected.twitter}
          busy={!!uploadBusy.twitter}
          accept=".zip,application/zip"
          acceptLabel="ZIP file"
          exportUrl="https://x.com/settings/download_your_data"
          guide={[{ text: "Request your archive on the next screen." }]}
          onFile={(f) => onFileUpload("twitter", f)}
        />

        <FileCard
          Icon={LumaIcon}
          name="Luma"
          blurb="Add guests from events you host."
          connected={!!connected.luma}
          busy={!!uploadBusy.luma}
          accept=".csv,text/csv"
          acceptLabel="CSV file"
          exportUrl="https://lu.ma/home"
          guide={[
            { text: "Open an event you host → Guests tab." },
            { text: "Click Export and download as CSV." },
          ]}
          onFile={(f) => onFileUpload("luma", f)}
        />

        <FileCard
          Icon={InstagramIcon}
          name="Instagram"
          blurb="Add your mutual followers."
          connected={!!connected.instagram}
          busy={!!uploadBusy.instagram}
          accept=".zip,.json,.html,application/zip,application/json,text/html"
          acceptLabel="ZIP, JSON, or HTML"
          exportUrl="https://accountscenter.instagram.com/info_and_permissions/dyi/"
          guide={[{ text: "Request a download → Connections → JSON or HTML." }]}
          onFile={(f) => onFileUpload("instagram", f)}
        />
      </div>

      {uploadError && <p className="mt-3 text-xs text-destructive-foreground">{uploadError}</p>}
      {error && <p className="mt-3 text-sm text-destructive-foreground">{error}</p>}

      <div className="mt-6 flex flex-col gap-2">
        <Button onClick={onBuild} className="w-full">Build my network</Button>
        {connectedCount === 0 && (
          <p className="text-center text-xs text-muted-foreground">
            No sources yet — you can connect them later in Settings.
          </p>
        )}
      </div>
    </div>
  );
}

function SourceCard({
  Icon, name, blurb, connected, children,
}: {
  Icon: React.ComponentType<React.SVGProps<SVGSVGElement>>;
  name: string; blurb: string; connected: boolean;
  children?: React.ReactNode;
}) {
  return (
    <div className={cn(
      "rounded-xl border bg-card p-4 [box-shadow:var(--shadow-s)]",
      connected ? "border-[oklch(0.42_0.11_152/0.4)]" : "border-border",
    )}>
      <div className="flex items-start gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg [background-image:var(--velour-raised)] [box-shadow:var(--shadow-button)]">
          <Icon className="size-4.5" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-foreground">{name}</span>
            {connected && (
              <span className="flex items-center gap-1 rounded-full bg-[oklch(0.92_0.06_150)] px-2 py-0.5 text-[11px] font-medium text-[oklch(0.42_0.11_152)]">
                <CheckIcon className="size-2.5" aria-hidden />
                Connected
              </span>
            )}
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">{blurb}</p>
        </div>
      </div>
      {children && <div className="mt-3">{children}</div>}
    </div>
  );
}

function OAuthCard({
  Icon, name, blurb, connected, startUrl,
}: {
  Icon: React.ComponentType<React.SVGProps<SVGSVGElement>>;
  name: string; blurb: string;
  connected: boolean; startUrl: string;
}) {
  return (
    <div className={cn(
      "flex items-center gap-3 rounded-xl border bg-card p-4 [box-shadow:var(--shadow-s)]",
      connected ? "border-[oklch(0.42_0.11_152/0.4)]" : "border-border",
    )}>
      <span className="flex size-9 shrink-0 items-center justify-center rounded-lg [background-image:var(--velour-raised)] [box-shadow:var(--shadow-button)]">
        <Icon className="size-4.5" aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-foreground">{name}</span>
          {connected && (
            <span className="flex items-center gap-1 rounded-full bg-[oklch(0.92_0.06_150)] px-2 py-0.5 text-[11px] font-medium text-[oklch(0.42_0.11_152)]">
              <CheckIcon className="size-2.5" aria-hidden />
              Connected
            </span>
          )}
        </div>
        <p className="mt-0.5 text-xs text-muted-foreground">{blurb}</p>
      </div>
      {!connected && (
        <Button asChild size="sm" variant="outline" className="shrink-0 gap-1.5">
          <a href={startUrl}>
            <Icon className="size-3.5" aria-hidden />
            Connect
          </a>
        </Button>
      )}
    </div>
  );
}

function FileCard({
  Icon, name, blurb, connected, busy, accept, acceptLabel,
  exportUrl, guide, onFile,
}: {
  Icon: React.ComponentType<React.SVGProps<SVGSVGElement>>;
  name: string; blurb: string;
  connected: boolean; busy: boolean;
  accept: string; acceptLabel: string;
  exportUrl: string;
  guide: { text: string; warn?: string }[];
  onFile: (f: File) => void;
}) {
  return (
    <SourceCard Icon={Icon} name={name} blurb={blurb} connected={connected}>
      {!connected && (
        <div className="flex flex-col gap-2.5">
          <Dialog>
            <DialogTrigger asChild>
              <button
                type="button"
                className="flex cursor-pointer items-center gap-1.5 text-left text-xs font-medium text-primary/70 hover:text-primary"
              >
                <FileTextIcon className="size-3.5 shrink-0 text-primary" aria-hidden />
                How to export your data
              </button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Export from {name}</DialogTitle>
              </DialogHeader>
              <ol className="flex flex-col gap-3 pt-1">
                {guide.map((s, i) => (
                  <li key={i} className="flex gap-3 text-sm text-secondary-foreground">
                    <span className="flex size-5 shrink-0 items-center justify-center rounded bg-primary/15 text-[11px] font-semibold text-primary">{i + 1}</span>
                    <span>{s.text}{s.warn && <span className="mt-1 block text-[oklch(0.78_0.14_22)] text-xs">{s.warn}</span>}</span>
                  </li>
                ))}
              </ol>
              <Button asChild variant="outline" className="mt-2 gap-1.5">
                <a href={exportUrl} target="_blank" rel="noopener noreferrer">
                  Open {name} export <ExternalLinkIcon className="size-3.5" aria-hidden />
                </a>
              </Button>
            </DialogContent>
          </Dialog>
          <Dropzone accept={accept} acceptLabel={acceptLabel} busy={busy} onFile={onFile} />
        </div>
      )}
    </SourceCard>
  );
}

function ExtensionCard({ connected, onMark }: { connected: boolean; onMark: () => void }) {
  return (
    <SourceCard Icon={ChromeIcon} name="Chrome Extension" blurb="Capture LinkedIn mutual connections as you browse." connected={connected}>
      {!connected && (
        <div className="flex flex-col gap-3">
          <ol className="grid grid-cols-2 gap-x-6 gap-y-1.5">
            {[
              "Download the Warmline extension and unzip it.",
              "Open chrome://extensions, enable Developer mode.",
              "Click Load unpacked and select the folder.",
              "Open a lead's LinkedIn profile to capture mutuals.",
            ].map((text, i) => (
              <li key={i} className="flex gap-2 text-xs text-secondary-foreground">
                <span className="flex size-4 shrink-0 items-center justify-center rounded bg-primary/15 text-[10px] font-semibold text-primary">{i + 1}</span>
                {text}
              </li>
            ))}
          </ol>
          <div className="flex gap-2">
            <Button asChild variant="outline" size="sm" className="gap-1.5">
              <a href="https://github.com/warmline/extension/releases/latest" target="_blank" rel="noopener noreferrer">
                <DownloadIcon className="size-3.5" aria-hidden />
                Download
              </a>
            </Button>
            <Button size="sm" variant="ghost" className="gap-1.5" onClick={onMark}>
              <CheckIcon className="size-3.5" aria-hidden />
              Mark installed
            </Button>
          </div>
        </div>
      )}
    </SourceCard>
  );
}

function Dropzone({
  accept, acceptLabel, busy, onFile,
}: {
  accept: string; acceptLabel: string; busy: boolean; onFile: (f: File) => void;
}) {
  const [dragging, setDragging] = useState(false);
  function handle(files: FileList | null) { const f = files?.[0]; if (f) onFile(f); }
  return (
    <label
      onDragOver={(e) => { e.preventDefault(); if (!busy) setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => { e.preventDefault(); setDragging(false); if (!busy) handle(e.dataTransfer.files); }}
      className={cn(
        "flex cursor-pointer flex-col items-center gap-1.5 rounded-lg border border-dashed p-4 text-center transition-colors [box-shadow:var(--shadow-inset)]",
        dragging ? "border-ring/60 bg-primary/5" : "border-border bg-input hover:border-ring/30",
        busy && "pointer-events-none opacity-60",
      )}
    >
      <UploadIcon className="size-4 text-muted-foreground" aria-hidden />
      <span className="text-xs font-medium text-foreground/85">
        {busy ? "Importing…" : `Drop ${acceptLabel} here or click to browse`}
      </span>
      <input type="file" accept={accept} disabled={busy} className="hidden" onChange={(e) => handle(e.target.files)} />
    </label>
  );
}
