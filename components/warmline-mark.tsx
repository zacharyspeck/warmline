import { cn } from "@/lib/utils";

// Brand mark: the three-node "W" monogram. Single-color by design — it inherits
// `currentColor`, so callers set the tint with a text-* class (amber = text-primary).
// No hardcoded hex; the color comes from the theme.
export function WarmlineMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 64 64"
      // Intrinsic size = the intended header size (size-6). Without it an
      // svg has no dimensions of its own and stretches to its container
      // whenever the utility class isn't in effect; CSS still overrides.
      width={24}
      height={24}
      className={className}
      role="img"
      aria-label="Warmline"
      fill="none"
    >
      <path
        d="M11 18 L22 46 L32 27 L42 46 L53 18"
        fill="none"
        stroke="currentColor"
        strokeWidth="6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="11" cy="18" r="5.6" fill="currentColor" />
      <circle cx="32" cy="27" r="5.6" fill="currentColor" />
      <circle cx="53" cy="18" r="5.6" fill="currentColor" />
    </svg>
  );
}

// Full lockup: amber mark + "Warmline" wordmark. The wordmark is real text in the
// display font (Schibsted Grotesk, loaded via next/font), so it stays crisp and
// on-brand — an external <img> of the SVG could not pick up the page font.
export function WarmlineLockup({
  className,
  markClassName,
}: {
  className?: string;
  markClassName?: string;
}) {
  return (
    <span className={cn("flex items-center gap-2", className)}>
      <WarmlineMark
        className={cn("size-[22px] shrink-0 text-primary", markClassName)}
      />
      <span className="font-display text-base font-semibold tracking-[-0.035em] text-foreground">
        Warmline
      </span>
    </span>
  );
}
