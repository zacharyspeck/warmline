"use client";

import { useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { format } from "date-fns";
import { Toaster, toast } from "sonner";
import { api } from "@/convex/_generated/api";
import type { Doc } from "@/convex/_generated/dataModel";
import Link from "next/link";
import {
  CheckIcon,
  DownloadIcon,
  Trash2Icon,
  UploadIcon,
} from "@/components/icons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  CONNECTORS,
  type ConnectorDef,
} from "@/app/connectors/connectors-config";

type Row = Doc<"connectors">;

// The connectors surface (S5): the LinkedIn dropzone hero plus one row per
// source. Self-contained (owns its query and toasts) so /connectors and the
// onboarding connect step render exactly the same thing.
//
// Honesty pass: only the LinkedIn export upload works today. Every other
// source stays visible but renders as a disabled Coming soon card — no
// Connect button, no dropzone, no dialog, no extension download.
export function ConnectorsSurface() {
  const rows = useQuery(api.connectors.list);

  return (
    <div>
      <Toaster theme="dark" position="bottom-right" richColors />

      {/* S5: LinkedIn is the hero — a working drag-and-drop right on the page. */}
      <LinkedInHero
        def={CONNECTORS.find((d) => d.provider === "linkedin")!}
        rows={(rows ?? []).filter((r) => r.provider === "linkedin")}
      />

      <section className="mt-3 flex flex-col gap-2.5">
        {CONNECTORS.filter((def) => def.provider !== "linkedin").map((def) =>
          def.provider === "extension" ? (
            <ExtensionRow key={def.provider} def={def} />
          ) : (
            <ComingSoonRow
              key={def.provider}
              def={def}
              rows={(rows ?? []).filter((r) => r.provider === def.provider)}
            />
          ),
        )}
      </section>
    </div>
  );
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

// ── Every other source: visible, but honestly not wired up yet ──────────────
// Rows recorded before the source was disabled (an earlier beta upload, a
// linked extension) stay visible and removable here — otherwise their stored
// exports would be stranded with no UI path to delete them.
function ComingSoonRow({ def, rows }: { def: ConnectorDef; rows: Row[] }) {
  const { Icon } = def;
  return (
    <div className="rounded-xl border border-border bg-card p-4 [box-shadow:var(--shadow-s)]">
      <div aria-disabled className="flex items-center gap-4 opacity-60">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-lg [background-image:var(--velour-raised)] [box-shadow:var(--shadow-button)]">
          <Icon className="size-5" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="font-medium">{def.name}</span>
            <Badge variant="secondary" className="text-[10px]">
              Coming soon
            </Badge>
          </div>
          <p className="truncate text-sm text-muted-foreground">{def.blurb}</p>
        </div>
      </div>
      {rows.length > 0 ? (
        <div className="mt-3 flex flex-col gap-2">
          {rows.map((row) => (
            <RecordRow key={row._id} row={row} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

// ── The browser extension: a real, working install now (task: revive it) ─────
function ExtensionRow({ def }: { def: ConnectorDef }) {
  const { Icon } = def;
  const ext = def.extension!;
  return (
    <div className="rounded-xl border border-border bg-card p-4 [box-shadow:var(--shadow-s)]">
      <div className="flex items-center gap-4">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-lg [background-image:var(--velour-raised)] [box-shadow:var(--shadow-button)]">
          <Icon className="size-5" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <span className="font-medium">{def.name}</span>
          <p className="truncate text-sm text-muted-foreground">{ext.intro}</p>
        </div>
        <Button asChild variant="primary" size="sm" className="gap-1.5">
          <a href="/api/extension/download" download>
            <DownloadIcon className="size-3.5" aria-hidden />
            Download
          </a>
        </Button>
      </div>
      <ol className="mt-3 flex flex-col gap-1.5 rounded-lg border border-border bg-background/40 p-3 text-sm text-muted-foreground">
        <li>1. Download the zip above and unzip it</li>
        <li>2. Open chrome://extensions, enable Developer mode</li>
        <li>3. Click Load unpacked and pick the unzipped folder</li>
        <li>
          4. Generate a token in{" "}
          <Link
            href="/settings"
            className="font-medium text-primary underline-offset-4 hover:underline"
          >
            Settings
          </Link>{" "}
          and paste it plus the server URL into the extension
        </li>
        <li>
          5. On a LinkedIn profile, click Capture. It grabs the person plus any
          mutuals shown by name
        </li>
        <li>
          6. If some mutuals show by name only, open that person&rsquo;s mutual
          connections list and click Capture mutuals shown to add the rest
        </li>
      </ol>
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
        onChange={(e) => {
          handle(e.target.files);
          // Reset so picking the SAME file again (e.g. retrying after a
          // failed upload) still fires a change event.
          e.currentTarget.value = "";
        }}
      />
    </label>
  );
}

function RecordRow({ row }: { row: Row }) {
  const disconnect = useMutation(api.connectors.disconnect);
  const subtitle =
    row.method === "oauth"
      ? row.accountEmail ?? "Connected"
      : [
          // The parsed contact count, stamped by the import action.
          row.contactCount !== undefined
            ? `${row.contactCount.toLocaleString()} contacts`
            : null,
          `Uploaded on ${format(new Date(row._creationTime), "d MMM yyyy")}`,
        ]
          .filter(Boolean)
          .join(" · ");

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
