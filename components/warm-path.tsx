"use client";

import type { FunctionReturnType } from "convex/server";
import { api } from "@/convex/_generated/api";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";

// S6: the warm path as a calm three-node line — You, through the person who
// bridges you, to the target — with the relationship evidence as a chip over
// the connecting line. The three-node shape deliberately echoes the W mark.
// Replaces the React Flow graph; same data, straight from
// graph.pathForPerson / demo.pathForPerson.

export type WarmPathData = FunctionReturnType<typeof api.graph.pathForPerson>;

function initialsOf(name: string) {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
}

function firstName(name: string) {
  return name.split(/\s+/)[0] ?? name;
}

function PathNode({
  name,
  sub,
  avatarUrl,
  accent,
}: {
  name: string;
  sub: string;
  avatarUrl?: string;
  accent?: boolean;
}) {
  return (
    <div className="flex w-24 shrink-0 flex-col items-center gap-1.5 text-center">
      <Avatar
        className={cn(
          "size-14",
          accent
            ? "ring-2 ring-primary ring-offset-2 ring-offset-card"
            : "ring-1 ring-border",
        )}
      >
        {avatarUrl ? <AvatarImage src={avatarUrl} alt="" /> : null}
        <AvatarFallback className="text-sm">{initialsOf(name)}</AvatarFallback>
      </Avatar>
      <div>
        <p
          className={cn(
            "text-[13px] font-semibold leading-tight",
            accent ? "text-primary" : "text-foreground",
          )}
        >
          {name}
        </p>
        <p className="text-[11px] text-muted-foreground">{sub}</p>
      </div>
    </div>
  );
}

function Segment({ chip }: { chip?: string }) {
  return (
    <div className="relative mt-7 h-px min-w-8 flex-1 bg-primary/50">
      {chip ? (
        <span className="absolute -top-9 left-1/2 max-w-44 -translate-x-1/2 truncate whitespace-nowrap rounded-full border border-border bg-card px-2.5 py-1 text-[11px] text-muted-foreground">
          {chip}
        </span>
      ) : null}
    </div>
  );
}

export function WarmPath({ data }: { data: WarmPathData }) {
  if (data.kind === "lead") {
    const bridge = data.connectors[0];
    const others = data.connectors.slice(1);
    return (
      <div className="rounded-xl border border-border bg-background/40 p-5">
        <p className="text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground/60">
          The warm path
        </p>
        {bridge ? (
          <>
            <div className="mt-8 flex items-start justify-between gap-1">
              <PathNode
                name={data.you.name}
                sub="You"
                avatarUrl={data.you.avatarUrl}
              />
              <Segment />
              <PathNode
                name={bridge.name}
                sub="Your bridge"
                avatarUrl={bridge.avatarUrl}
              />
              <Segment chip={bridge.evidence} />
              <PathNode
                name={data.target.name}
                sub="Target"
                avatarUrl={data.target.avatarUrl}
                accent
              />
            </div>
            <p className="mt-5 text-center text-sm text-muted-foreground">
              <span className="font-medium text-foreground">
                {bridge.name}
              </span>{" "}
              is your warmest path to {firstName(data.target.name)}. One
              direct, credible intro away
            </p>
            {others.length > 0 && (
              <p className="mt-1.5 text-center text-xs text-muted-foreground/70">
                Also bridges you: {others.map((c) => c.name).join(", ")}
              </p>
            )}
          </>
        ) : (
          <div className="mt-4 flex items-center gap-4">
            <PathNode
              name={data.you.name}
              sub="You"
              avatarUrl={data.you.avatarUrl}
            />
            <div className="mt-[-14px] h-px flex-1 border-t border-dashed border-border" />
            <PathNode
              name={data.target.name}
              sub="Target"
              avatarUrl={data.target.avatarUrl}
              accent
            />
          </div>
        )}
        {!bridge && (
          <p className="mt-4 text-center text-sm text-muted-foreground">
            No warm bridge yet. This one starts with direct outreach
          </p>
        )}
      </div>
    );
  }

  // Connector: You → connector, then the doors they open.
  return (
    <div className="rounded-xl border border-border bg-background/40 p-5">
      <p className="text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground/60">
        The warm path
      </p>
      <div className="mt-8 flex items-start gap-1">
        <PathNode
          name={data.you.name}
          sub="You"
          avatarUrl={data.you.avatarUrl}
        />
        <Segment />
        <PathNode
          name={data.connector.name}
          sub="Your bridge"
          avatarUrl={data.connector.avatarUrl}
          accent
        />
        <div className="mt-1 min-w-0 flex-[2] pl-4">
          <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground/60">
            Unlocks {data.unlocks.length} lead
            {data.unlocks.length === 1 ? "" : "s"}
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {data.unlocks.map((u) => (
              <span
                key={u.id}
                className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-2 py-0.5 text-xs text-secondary-foreground"
              >
                <Avatar className="size-4">
                  {u.avatarUrl ? <AvatarImage src={u.avatarUrl} alt="" /> : null}
                  <AvatarFallback className="text-[8px]">
                    {initialsOf(u.name)}
                  </AvatarFallback>
                </Avatar>
                {u.name}
              </span>
            ))}
            {data.unlocks.length === 0 && (
              <span className="text-xs text-muted-foreground">
                No mapped leads yet
              </span>
            )}
          </div>
        </div>
      </div>
      <p className="mt-5 text-center text-sm text-muted-foreground">
        <span className="font-medium text-foreground">
          {data.connector.name}
        </span>{" "}
        opens {data.unlocks.length === 1 ? "a door" : "doors"} you want.
        Befriend the bridge first
      </p>
    </div>
  );
}
