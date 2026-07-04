"use client";

import { useMemo } from "react";
import { useReducedMotion } from "motion/react";
import {
  ReactFlow,
  Background,
  Handle,
  Position,
  MarkerType,
  type Node,
  type Edge,
  type NodeProps,
  type NodeTypes,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { FunctionReturnType } from "convex/server";
import { api } from "@/convex/_generated/api";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";

// The organic warm-path graph (S6): the animated, curved family-tree view of
// You → Connector(s) → Lead (or a connector's fan-out to the leads they
// unlock). Recovered from the pre-rename WarmGraph. Same data straight from
// graph.pathForPerson / demo.pathForPerson.
//
//  • lead      → paths-in:  You → [Connectors] → Lead   (edges show evidence)
//  • connector → fan-out:   You → Connector → [Leads]   ("+N more" past the cap)
//
// Lazy-mounted (only rendered when a card expands, and code-split via
// next/dynamic at the call site), node count hard-capped, edge animation
// disabled under prefers-reduced-motion.

export type WarmGraphData = FunctionReturnType<typeof api.graph.pathForPerson>;

// ── Layout ──
// A clean 3-layer left-to-right DAG: You → Connectors → Target (or the
// connector fan-out). Single-node layers (You, Target) sit at the vertical
// center of the multi-node column so the path reads straight across.
const NODE_W = 190;
const NODE_H = 56;
const COL_GAP = 160; // horizontal room for edges + evidence labels
const ROW_GAP = NODE_H + 40; // 96: even vertical spacing, no overlap
const COL = {
  you: 0,
  mid: NODE_W + COL_GAP,
  right: 2 * (NODE_W + COL_GAP),
};
const MAX_NODES = 12; // hard cap on rendered nodes

function colY(i: number, n: number): number {
  return (i - (n - 1) / 2) * ROW_GAP;
}

// Keep edge labels short so they never overlap the nodes they sit between.
function shortLabel(s: string, max = 30): string {
  return s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s;
}

function initialsOf(name: string): string {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((p) => p[0]?.toUpperCase() ?? "")
      .join("") || "?"
  );
}

// ── Custom nodes ──
type Tone = "you" | "connector" | "lead";
type PersonData = { name: string; tone: Tone; avatarUrl?: string };
type MoreData = { label: string };

// On-brand avatar tints from the design-system chart palette (amber shades).
const TONE: Record<Tone, { avatar: string; label: string }> = {
  you: { avatar: "bg-[var(--chart-1)]", label: "You" },
  connector: { avatar: "bg-[var(--chart-2)]", label: "Connector" },
  lead: { avatar: "bg-[var(--chart-4)]", label: "Lead" },
};

function PersonNode({ data }: NodeProps) {
  const d = data as unknown as PersonData;
  const tone = TONE[d.tone];
  return (
    <div className="flex w-[190px] items-center gap-3 rounded-xl border border-border bg-card px-3 py-2 [box-shadow:var(--shadow-s)]">
      <Handle
        type="target"
        position={Position.Left}
        className="!h-2 !w-2 !border-0 !bg-foreground/30"
      />
      <Avatar className={cn("size-9 text-xs text-white", tone.avatar)}>
        {d.avatarUrl ? <AvatarImage src={d.avatarUrl} alt="" /> : null}
        <AvatarFallback className={cn("text-white", tone.avatar)}>
          {initialsOf(d.name)}
        </AvatarFallback>
      </Avatar>
      <div className="min-w-0">
        <div className="truncate text-sm font-medium leading-tight text-card-foreground">
          {d.name}
        </div>
        <span className="mt-1 inline-block rounded-full bg-muted px-1.5 py-px text-[10px] font-medium text-muted-foreground">
          {tone.label}
        </span>
      </div>
      <Handle
        type="source"
        position={Position.Right}
        className="!h-2 !w-2 !border-0 !bg-foreground/30"
      />
    </div>
  );
}

function MoreNode({ data }: NodeProps) {
  const d = data as unknown as MoreData;
  return (
    <div className="rounded-full border border-dashed border-border bg-muted px-3 py-1.5 text-xs font-medium text-muted-foreground">
      <Handle
        type="target"
        position={Position.Left}
        className="!h-2 !w-2 !border-0 !bg-transparent"
      />
      {d.label}
    </div>
  );
}

const nodeTypes: NodeTypes = { person: PersonNode, more: MoreNode };

// ── Edge styling ── same confidence palette as the list's Why dots.
const MUTED_STROKE = "oklch(0.6 0.02 260)";
function confStroke(confidence: number): string {
  return confidence >= 0.66
    ? "oklch(0.78 0.12 165)"
    : confidence >= 0.33
      ? "oklch(0.8 0.11 85)"
      : MUTED_STROKE;
}

function flowEdge(
  id: string,
  source: string,
  target: string,
  opts: {
    label?: string;
    confidence?: number;
    dashed?: boolean;
    animated?: boolean;
  } = {},
): Edge {
  const stroke =
    opts.confidence !== undefined ? confStroke(opts.confidence) : MUTED_STROKE;
  return {
    id,
    source,
    target,
    animated: opts.animated ?? false,
    label: opts.label,
    labelStyle: { fontSize: 11, fill: "currentColor" },
    labelBgPadding: [6, 3],
    labelBgBorderRadius: 6,
    style: {
      stroke,
      strokeWidth: opts.confidence !== undefined ? 1.5 + opts.confidence : 1.5,
      strokeDasharray: opts.dashed ? "5 5" : undefined,
    },
    markerEnd: { type: MarkerType.ArrowClosed, color: stroke },
  };
}

function buildGraph(
  data: WarmGraphData,
  animate: boolean,
): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = [];
  const edges: Edge[] = [];
  const solid = (
    id: string,
    source: string,
    target: string,
    opts: { label?: string; confidence?: number } = {},
  ) => flowEdge(id, source, target, { ...opts, animated: animate });

  nodes.push({
    id: "you",
    type: "person",
    position: { x: COL.you, y: 0 },
    data: {
      name: data.you.name,
      tone: "you",
      avatarUrl: data.you.avatarUrl,
    } satisfies PersonData,
  });

  if (data.kind === "lead") {
    // Cap connectors so total nodes (you + connectors + target) ≤ MAX_NODES.
    const cap = MAX_NODES - 2;
    const shown = data.connectors.slice(0, cap);
    const more = data.connectors.length - shown.length;
    const colCount = shown.length + (more > 0 ? 1 : 0);

    shown.forEach((c, i) => {
      nodes.push({
        id: `c-${c.id}`,
        type: "person",
        position: { x: COL.mid, y: colY(i, colCount || 1) },
        data: {
          name: c.name,
          tone: "connector",
          avatarUrl: c.avatarUrl,
        } satisfies PersonData,
      });
      edges.push(solid(`e-you-${c.id}`, "you", `c-${c.id}`));
      edges.push(
        solid(`e-${c.id}-target`, `c-${c.id}`, "target", {
          label: shortLabel(c.evidence),
          confidence: c.confidence,
        }),
      );
    });

    if (more > 0) {
      nodes.push({
        id: "more",
        type: "more",
        position: { x: COL.mid, y: colY(shown.length, colCount) },
        data: { label: `+${more} more` } satisfies MoreData,
      });
      edges.push(flowEdge("e-you-more", "you", "more", { dashed: true }));
    }

    nodes.push({
      id: "target",
      type: "person",
      position: { x: COL.right, y: 0 },
      data: {
        name: data.target.name,
        tone: "lead",
        avatarUrl: data.target.avatarUrl,
      } satisfies PersonData,
    });

    // No known connector yet — show the cold gap explicitly.
    if (shown.length === 0) {
      edges.push(
        flowEdge("e-you-target", "you", "target", {
          label: "no warm path yet",
          dashed: true,
        }),
      );
    }
    return { nodes, edges };
  }

  // kind === "connector" — fan-out You → Connector → [Leads].
  nodes.push({
    id: "conn",
    type: "person",
    position: { x: COL.mid, y: 0 },
    data: {
      name: data.connector.name,
      tone: "connector",
      avatarUrl: data.connector.avatarUrl,
    } satisfies PersonData,
  });
  edges.push(solid("e-you-conn", "you", "conn"));

  const cap = MAX_NODES - 2; // you + connector
  const shown = data.unlocks.slice(0, cap);
  const more = data.unlocks.length - shown.length;
  const colCount = shown.length + (more > 0 ? 1 : 0);

  shown.forEach((u, i) => {
    nodes.push({
      id: `u-${u.id}`,
      type: "person",
      position: { x: COL.right, y: colY(i, colCount || 1) },
      data: {
        name: u.name,
        tone: "lead",
        avatarUrl: u.avatarUrl,
      } satisfies PersonData,
    });
    edges.push(solid(`e-conn-${u.id}`, "conn", `u-${u.id}`));
  });

  if (more > 0) {
    nodes.push({
      id: "more",
      type: "more",
      position: { x: COL.right, y: colY(shown.length, colCount) },
      data: { label: `+${more} more` } satisfies MoreData,
    });
    edges.push(flowEdge("e-conn-more", "conn", "more", { dashed: true }));
  }

  return { nodes, edges };
}

export function WarmGraph({
  data,
  className,
}: {
  data: WarmGraphData;
  className?: string;
}) {
  // prefers-reduced-motion: keep the curved layout but stop the flowing edge
  // dashes so nothing animates for motion-sensitive users.
  const reduceMotion = useReducedMotion();
  const { nodes, edges } = useMemo(
    () => buildGraph(data, !reduceMotion),
    [data, reduceMotion],
  );

  return (
    <div
      className={cn(
        "h-[340px] w-full overflow-hidden rounded-xl border border-border bg-background/40 text-muted-foreground",
        className,
      )}
    >
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        onInit={(instance) => instance.fitView({ padding: 0.2 })}
        proOptions={{ hideAttribution: true }}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        panOnScroll={false}
        zoomOnScroll={false}
        zoomOnDoubleClick={false}
        minZoom={0.4}
        maxZoom={1.5}
      >
        <Background gap={16} className="!bg-transparent" />
      </ReactFlow>
    </div>
  );
}

export default WarmGraph;
