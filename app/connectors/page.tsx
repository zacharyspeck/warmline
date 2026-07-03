"use client";

import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { ConnectorsSurface } from "@/components/connectors-surface";
import { CONNECTORS, HOW_IT_WORKS } from "./connectors-config";

// The connectors page: header + the shared connectors surface (also rendered
// by the onboarding connect step) + the sources-connected footer.
export default function ConnectorsPage() {
  const rows = useQuery(api.connectors.list);
  const connectedCount = new Set((rows ?? []).map((r) => r.provider)).size;

  return (
    <main className="mx-auto flex min-h-full max-w-3xl flex-col justify-center px-6 py-10">
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

      <ConnectorsSurface />

      <p className="mt-8 text-xs text-muted-foreground">
        {rows === undefined
          ? "Loading your connections…"
          : `${connectedCount} of ${CONNECTORS.length} sources connected`}
      </p>
    </main>
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
