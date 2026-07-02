"use client";

import { useMemo, useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { format } from "date-fns";
import { Toaster, toast } from "sonner";
import { api } from "@/convex/_generated/api";
import type { Doc } from "@/convex/_generated/dataModel";
import {
  CheckIcon,
  DownloadIcon,
  ExternalLinkIcon,
  FileTextIcon,
  Trash2Icon,
  UploadIcon,
  ZapIcon,
} from "@/components/icons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import {
  CONNECTORS,
  HOW_IT_WORKS,
  type ConnectorDef,
  type Provider,
} from "./connectors-config";

type Row = Doc<"connectors">;

export default function ConnectorsPage() {
  const rows = useQuery(api.connectors.list);
  const byProvider = useMemo(() => groupByProvider(rows ?? []), [rows]);
  const connectedCount = Object.values(byProvider).filter(
    (r): r is Row[] => Boolean(r && r.length > 0),
  ).length;

  return (
    <main className="mx-auto flex min-h-full max-w-3xl flex-col justify-center px-6 py-10">
      <Toaster theme="dark" position="bottom-right" richColors />

      <header className="mb-8 flex items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-[28px] font-semibold tracking-tight text-foreground">
            Connectors
          </h1>
          <p className="mt-1.5 max-w-lg text-sm text-muted-foreground">
            Warmline reads your warm network from these sources. The more you
            connect, the sharper the intros. Only you can search what you add
          </p>
        </div>
        <HowItWorks />
      </header>

      {/* S5: LinkedIn is the hero — a working drag-and-drop right on the page. */}
      <LinkedInHero
        def={CONNECTORS.find((d) => d.provider === "linkedin")!}
        rows={byProvider.linkedin ?? []}
      />

      <section className="mt-3 flex flex-col gap-2.5">
        {CONNECTORS.filter((def) => def.provider !== "linkedin").map((def) => (
          <ConnectorRow
            key={def.provider}
            def={def}
            rows={byProvider[def.provider] ?? []}
          />
        ))}
      </section>

      <p className="mt-8 text-xs text-muted-foreground">
        {rows === undefined
          ? "Loading your connections…"
          : `${connectedCount} of ${CONNECTORS.length} sources connected`}
      </p>
    </main>
  );
}

function groupByProvider(rows: Row[]): Partial<Record<Provider, Row[]>> {
  const out: Partial<Record<Provider, Row[]>> = {};
  for (const row of rows) (out[row.provider] ??= []).push(row);
  return out;
}

// ── LinkedIn hero: the working drag-and-drop, inline on the page (S5) ───────
function LinkedInHero({ def, rows }: { def: ConnectorDef; rows: Row[] }) {
  const { Icon } = def;
  const generateUploadUrl = useMutation(api.connectors.generateUploadUrl);
  const recordUpload = useMutation(api.connectors.recordUpload);
  const parseLinkedIn = useAction(api.linkedinImport.parseLinkedInExport);
  const [busy, setBusy] = useState(false);
  const existing = rows.find((r) => r.method === "manual");

  async function onFile(file: File) {
    try {
      setBusy(true);
      const url = await generateUploadUrl();
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": file.type || "application/octet-stream" },
        body: file,
      });
      if (!res.ok) throw new Error("Upload failed");
      const { storageId } = (await res.json()) as {
        storageId: Row["storageId"];
      };
      await recordUpload({
        provider: "linkedin",
        method: "manual",
        label: "LinkedIn data",
        fileName: file.name,
        storageId,
      });
      if (storageId) {
        toast.success("Upload received, importing connections…");
        const { imported, skipped } = await parseLinkedIn({ storageId });
        toast.success(
          `Imported ${imported} connections (${skipped} already in graph)`,
        );
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-xl border border-border bg-card p-5 [box-shadow:var(--shadow-s)]">
      <div className="flex items-center gap-4">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-lg [background-image:var(--velour-raised)] [box-shadow:var(--shadow-button)]">
          <Icon className="size-5" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="font-medium">LinkedIn</span>
            {existing ? (
              <Badge variant="success" className="gap-1 text-[10px]">
                <CheckIcon className="size-2.5" aria-hidden />
                Connected
              </Badge>
            ) : null}
          </div>
          <p className="truncate text-sm text-muted-foreground">
            The backbone of your warm graph. Import your connections
          </p>
        </div>
      </div>

      <div className="mt-4">
        <Dropzone accept=".zip,application/zip" name="LinkedIn" busy={busy} onFile={onFile} />
        <p className="mt-2 text-center text-xs text-muted-foreground">
          Accepts the .zip from{" "}
          <a
            href="https://www.linkedin.com/mypreferences/d/download-my-data"
            target="_blank"
            rel="noopener noreferrer"
            className="underline underline-offset-4 hover:text-foreground"
          >
            LinkedIn → Settings → Data privacy → Get a copy of your data
          </a>
        </p>
      </div>

      {existing ? (
        <div className="mt-3">
          <RecordRow row={existing} />
        </div>
      ) : null}
    </div>
  );
}

// ── A single connector row + its connect dialog ────────────────────────────
function ConnectorRow({ def, rows }: { def: ConnectorDef; rows: Row[] }) {
  const [open, setOpen] = useState(false);
  const { Icon } = def;
  const connected = rows.length > 0;
  const hasTabs = Boolean(def.auto && def.manual);

  const status = connected
    ? `Your ${def.name} is connected`
    : def.blurb;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <div className="flex items-center gap-4 rounded-xl border border-border bg-card p-4 [box-shadow:var(--shadow-s)]">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-lg [background-image:var(--velour-raised)] [box-shadow:var(--shadow-button)]">
          <Icon className="size-5" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="font-medium">{def.name}</span>
            {def.beta ? (
              <Badge variant="secondary" className="text-[10px]">
                Beta
              </Badge>
            ) : null}
            {connected ? (
              <Badge variant="success" className="gap-1 text-[10px]">
                <CheckIcon className="size-2.5" aria-hidden />
                Active
              </Badge>
            ) : null}
          </div>
          <p className="truncate text-sm text-muted-foreground">{status}</p>
        </div>
        <DialogTrigger asChild>
          <Button variant={connected ? "outline" : "primary"} size="sm">
            {connected ? "Manage" : "Connect"}
          </Button>
        </DialogTrigger>
      </div>

      <DialogContent className="max-w-[460px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2.5 text-left">
            <Icon className="size-5" aria-hidden />
            Connect {def.name}
          </DialogTitle>
          {def.auto ? (
            <DialogDescription>
              Make your mutual {def.name} followers searchable
            </DialogDescription>
          ) : null}
        </DialogHeader>

        {def.oauth ? <OauthPanel def={def} rows={rows} /> : null}

        {hasTabs ? (
          <Tabs defaultValue="automatic">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="automatic">Automatic</TabsTrigger>
              <TabsTrigger value="manual">Manual</TabsTrigger>
            </TabsList>
            <TabsContent value="automatic">
              <AutoPanel def={def} rows={rows} />
            </TabsContent>
            <TabsContent value="manual">
              <ManualPanel def={def} rows={rows} />
            </TabsContent>
          </Tabs>
        ) : def.manual ? (
          <ManualPanel def={def} rows={rows} />
        ) : null}

        {def.extension ? <ExtensionPanel def={def} rows={rows} /> : null}
      </DialogContent>
    </Dialog>
  );
}

// ── OAuth (Google, Outlook) ────────────────────────────────────────────────
function OauthPanel({ def, rows }: { def: ConnectorDef; rows: Row[] }) {
  const { Icon } = def;
  const accounts = rows.filter((r) => r.method === "oauth");

  // Real OAuth: hand off to the provider's consent screen. The callback
  // (/api/connectors/<provider>/callback) records the connector and returns
  // here. Needs the OAuth client id/secret env vars to be set.
  const startUrl = `/api/connectors/${def.provider}`;

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm leading-relaxed text-muted-foreground">
        {def.oauth!.privacy}
      </p>
      <Button asChild className="gap-2">
        <a href={startUrl}>
          <Icon className="size-4" aria-hidden />
          {def.oauth!.buttonLabel}
        </a>
      </Button>

      {accounts.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {accounts.map((a) => (
            <RecordRow key={a._id} row={a} />
          ))}
        </ul>
      ) : null}

      {accounts.length > 0 ? (
        <Button
          asChild
          variant="ghost"
          size="sm"
          className="justify-start gap-2 text-muted-foreground"
        >
          <a href={startUrl}>+ Add account</a>
        </Button>
      ) : null}
    </div>
  );
}

// ── Automatic transfer (Instagram via Fabric) ──────────────────────────────
function AutoPanel({ def, rows }: { def: ConnectorDef; rows: Row[] }) {
  const auto = def.auto!;
  const recordUpload = useMutation(api.connectors.recordUpload);
  const [busy, setBusy] = useState(false);
  const existing = rows.find((r) => r.method === "auto");

  async function connect() {
    try {
      setBusy(true);
      // TODO: hand off to the partner's transfer flow; this records the link.
      await recordUpload({
        provider: def.provider,
        method: "auto",
        label: `${def.name} (via ${auto.partner})`,
      });
      toast.success(`${def.name} connected via ${auto.partner}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not connect");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4 rounded-xl border border-border bg-card/40 p-4">
      <div className="flex items-center gap-2 text-sm font-medium text-foreground">
        <ZapIcon className="size-4 text-primary" aria-hidden />
        {auto.partner}
      </div>
      <p className="text-xs leading-relaxed text-muted-foreground">
        {auto.partnerNote}
      </p>

      <ul className="flex flex-col gap-2.5">
        {auto.scopes.map((s) => (
          <li key={s.key} className="flex items-start gap-2.5">
            <Checkbox
              id={`scope-${def.provider}-${s.key}`}
              defaultChecked
              disabled={s.required}
              className="mt-0.5"
            />
            <label
              htmlFor={`scope-${def.provider}-${s.key}`}
              className="cursor-pointer"
            >
              <span className="flex items-center gap-1.5 text-sm text-foreground">
                {s.label}
                {s.required ? (
                  <Badge variant="primary" className="px-1.5 py-0 text-[10px]">
                    Required
                  </Badge>
                ) : null}
              </span>
              <span className="block text-xs text-muted-foreground">{s.sub}</span>
            </label>
          </li>
        ))}
      </ul>

      {existing ? (
        <RecordRow row={existing} />
      ) : (
        <Button onClick={connect} disabled={busy} className="gap-2">
          <ZapIcon className="size-4" aria-hidden />
          {busy ? "Connecting…" : auto.buttonLabel}
        </Button>
      )}
    </div>
  );
}

// ── Manual export upload (LinkedIn, Twitter, Instagram) ─────────────────────
function ManualPanel({ def, rows }: { def: ConnectorDef; rows: Row[] }) {
  const manual = def.manual!;
  const generateUploadUrl = useMutation(api.connectors.generateUploadUrl);
  const recordUpload = useMutation(api.connectors.recordUpload);
  const parseLinkedIn = useAction(api.linkedinImport.parseLinkedInExport);
  const [showGuide, setShowGuide] = useState(false);
  const [busy, setBusy] = useState(false);
  const existing = rows.find((r) => r.method === "manual");

  async function onFile(file: File) {
    try {
      setBusy(true);
      const url = await generateUploadUrl();
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": file.type || "application/octet-stream" },
        body: file,
      });
      if (!res.ok) throw new Error("Upload failed");
      const { storageId } = (await res.json()) as { storageId: Row["storageId"] };
      await recordUpload({
        provider: def.provider,
        method: "manual",
        label: `${def.name} data`,
        fileName: file.name,
        storageId,
      });

      // LinkedIn exports are parsed into the graph straight away; the rest just
      // land in storage until their parser lands.
      if (def.provider === "linkedin" && storageId) {
        toast.success("Upload received, importing connections…");
        const { imported, skipped } = await parseLinkedIn({ storageId });
        toast.success(`Imported ${imported} connections (${skipped} already in graph)`);
      } else {
        toast.success(`${def.name} data uploaded`);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Step 1 — export from the provider */}
      <button
        type="button"
        onClick={() => setShowGuide((s) => !s)}
        aria-expanded={showGuide}
        className="flex items-start gap-3 rounded-lg p-1 text-left transition-colors hover:text-foreground"
      >
        <FileTextIcon className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
        <span>
          <span className="flex items-center gap-1.5 text-sm font-medium text-foreground">
            Export your data
            <ExternalLinkIcon className="size-3 text-muted-foreground" aria-hidden />
          </span>
          <span className="block text-xs text-muted-foreground">
            Download your data from {def.name}
          </span>
        </span>
      </button>

      {showGuide ? (
        <div className="flex flex-col gap-3 rounded-xl border border-border bg-card/40 p-4">
          <ol className="flex flex-col gap-2.5">
            {manual.guide.map((step, i) => (
              <li key={i} className="flex gap-2.5 text-sm">
                <span className="flex size-5 shrink-0 items-center justify-center rounded-md bg-primary/15 text-[11px] font-semibold text-primary">
                  {i + 1}
                </span>
                <span className="text-secondary-foreground">
                  {step.text}
                  {step.warn ? (
                    <span className="mt-1 block text-xs text-[oklch(0.78_0.14_22)]">
                      {step.warn}
                    </span>
                  ) : null}
                </span>
              </li>
            ))}
          </ol>
          <Button asChild className="gap-2">
            <a href={manual.exportUrl} target="_blank" rel="noopener noreferrer">
              Continue to {def.name}
              <ExternalLinkIcon className="size-4" aria-hidden />
            </a>
          </Button>
        </div>
      ) : null}

      {/* Step 2 — upload the export */}
      <div className="flex items-start gap-3 p-1">
        <UploadIcon className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
        <span>
          <span className="block text-sm font-medium text-foreground">
            Upload your file
          </span>
          <span className="block text-xs text-muted-foreground">
            {manual.accept}
          </span>
        </span>
      </div>

      <Dropzone
        accept={manual.acceptMime}
        name={def.name}
        busy={busy}
        onFile={onFile}
      />

      {existing ? <RecordRow row={existing} /> : null}
    </div>
  );
}

// ── Shared bits ─────────────────────────────────────────────────────────────
function Dropzone({
  accept,
  name,
  busy,
  onFile,
}: {
  accept: string;
  name: string;
  busy: boolean;
  onFile: (file: File) => void;
}) {
  const [dragging, setDragging] = useState(false);
  const inputId = `upload-${name}`;

  function handle(files: FileList | null) {
    const file = files?.[0];
    if (file) onFile(file);
  }

  return (
    <label
      htmlFor={inputId}
      onDragOver={(e) => {
        e.preventDefault();
        if (!busy) setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        if (!busy) handle(e.dataTransfer.files);
      }}
      className={cn(
        "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border bg-input p-6 text-center [box-shadow:var(--shadow-inset)]",
        "transition-[border-color,background-color] duration-200",
        dragging ? "border-ring/60 bg-primary/5" : "hover:border-ring/30",
        busy && "pointer-events-none opacity-60",
      )}
    >
      <span className="flex size-9 items-center justify-center rounded-lg [background-image:var(--velour-raised)] [box-shadow:var(--shadow-button)]">
        <UploadIcon className="size-4 text-muted-foreground" aria-hidden />
      </span>
      <span className="text-sm font-medium text-foreground/85">
        {busy ? "Uploading…" : `Drop your ${name} export here or click to browse`}
      </span>
      <span className="text-xs text-muted-foreground">
        Your export is imported as soon as the upload finishes
      </span>
      <input
        id={inputId}
        type="file"
        accept={accept}
        disabled={busy}
        className="hidden"
        onChange={(e) => handle(e.target.files)}
      />
    </label>
  );
}

function RecordRow({ row }: { row: Row }) {
  const disconnect = useMutation(api.connectors.disconnect);
  const subtitle =
    row.method === "oauth"
      ? row.accountEmail ?? "Connected"
      : `Uploaded on ${format(new Date(row._creationTime), "d MMM yyyy")}`;

  return (
    <div className="flex items-center gap-3 rounded-lg px-3 py-2 [background-image:var(--velour)] [box-shadow:var(--shadow-s)]">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm text-foreground">{row.label}</p>
        <p className="truncate text-xs text-muted-foreground">{subtitle}</p>
      </div>
      <Badge variant="success" className="gap-1">
        <CheckIcon className="size-3" aria-hidden />
        Active
      </Badge>
      <Button
        variant="ghost"
        size="icon"
        className="size-8 text-muted-foreground hover:text-destructive-foreground"
        aria-label={`Remove ${row.label}`}
        onClick={() =>
          void disconnect({ id: row._id }).then(
            () => toast.success(`${row.label} removed`),
            (e: unknown) =>
              toast.error(e instanceof Error ? e.message : "Could not remove"),
          )
        }
      >
        <Trash2Icon className="size-4" aria-hidden />
      </Button>
    </div>
  );
}

// ── Browser extension (LinkedIn mutuals from the user's own session) ────────
function ExtensionPanel({ def, rows }: { def: ConnectorDef; rows: Row[] }) {
  const ext = def.extension!;
  const recordUpload = useMutation(api.connectors.recordUpload);
  const [busy, setBusy] = useState(false);
  const existing = rows.find((r) => r.method === "extension");

  async function markInstalled() {
    try {
      setBusy(true);
      await recordUpload({
        provider: def.provider,
        method: "extension",
        label: "Chrome extension",
      });
      toast.success("Extension linked");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not link");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm leading-relaxed text-muted-foreground">{ext.intro}</p>

      <Button asChild variant="outline" className="gap-2">
        <a href={ext.downloadUrl} target="_blank" rel="noopener noreferrer">
          <DownloadIcon className="size-4" aria-hidden />
          Download the extension
        </a>
      </Button>

      <ol className="flex flex-col gap-2.5 rounded-xl border border-border bg-card/40 p-4">
        {ext.steps.map((step, i) => (
          <li key={i} className="flex gap-2.5 text-sm">
            <span className="flex size-5 shrink-0 items-center justify-center rounded-md bg-primary/15 text-[11px] font-semibold text-primary">
              {i + 1}
            </span>
            <span className="text-secondary-foreground">{step.text}</span>
          </li>
        ))}
      </ol>

      {existing ? (
        <RecordRow row={existing} />
      ) : (
        <Button onClick={markInstalled} disabled={busy} className="gap-2">
          <CheckIcon className="size-4" aria-hidden />
          {busy ? "Linking…" : ext.buttonLabel}
        </Button>
      )}
    </div>
  );
}

function HowItWorks() {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          How it works
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-[440px]">
        <DialogHeader>
          <DialogTitle className="text-left">How connectors work</DialogTitle>
        </DialogHeader>
        <ul className="flex flex-col gap-4">
          {HOW_IT_WORKS.map(({ Icon, title, body }) => (
            <li key={title} className="flex gap-3">
              <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-primary/15 text-primary">
                <Icon className="size-4" aria-hidden />
              </span>
              <div>
                <p className="text-sm font-medium text-foreground">{title}</p>
                <p className="text-xs leading-relaxed text-muted-foreground">
                  {body}
                </p>
              </div>
            </li>
          ))}
        </ul>
      </DialogContent>
    </Dialog>
  );
}
