import type { Metadata } from "next";
import Link from "next/link";

// DRAFT, unlinked and noindex until the owner's voice pass (see MANUAL_TODO).
// Copy rules: no em dashes, no this-not-that constructions, bullets and labels
// carry no trailing period.
export const metadata: Metadata = {
  title: "How to ask for a warm introduction · Warmline",
  description:
    "A short, practical guide to asking for and giving warm introductions well.",
  robots: { index: false, follow: false },
};

export default function WarmIntrosGuide() {
  return (
    <main className="mx-auto w-full max-w-2xl px-6 py-12">
      <Link
        href="/"
        className="text-sm font-semibold tracking-tight text-foreground/80 hover:text-foreground"
      >
        Warmline
      </Link>
      <h1 className="mt-6 font-display text-2xl font-semibold tracking-tight">
        How to ask for a warm introduction
      </h1>
      <p className="mt-3 text-sm leading-relaxed text-foreground/70">
        A warm introduction is one where a person you both know vouches for the
        connection. It is the highest-converting way to reach someone new. Here
        is how to ask for one well, and how to give a good one back.
      </p>

      <h2 className="mt-8 text-lg font-semibold tracking-tight">
        Start with a double opt-in
      </h2>
      <p className="mt-3 text-sm leading-relaxed text-foreground/70">
        Ask your connector first, in private, before anyone is put on a thread.
        Give them an easy way to say no. When they agree, let them check with
        the other person so that both sides have opted in before the
        introduction is made. This protects your connector&rsquo;s
        relationships and makes the intro land warmer.
      </p>

      <h2 className="mt-8 text-lg font-semibold tracking-tight">
        Make it forwardable
      </h2>
      <p className="mt-3 text-sm leading-relaxed text-foreground/70">
        Write a short blurb your connector can paste with one click. Keep it to
        a few lines: who you are, one line of credibility, why you want to reach
        this person, and the specific ask. The easier you make it to forward,
        the more likely it happens.
      </p>
      <ul className="mt-3 list-disc space-y-1.5 pl-5 text-sm text-foreground/70">
        <li>Who you are, in one honest line</li>
        <li>Why this person, specifically, and why now</li>
        <li>The one thing you are asking for, small and concrete</li>
      </ul>

      <h2 className="mt-8 text-lg font-semibold tracking-tight">
        Ask the right connector
      </h2>
      <p className="mt-3 text-sm leading-relaxed text-foreground/70">
        Pick the connector who actually knows the person well and would be glad
        to help. A strong tie makes the vouch mean something, so one good
        introducer beats several distant mutuals. This is exactly what
        Warmline&rsquo;s warm-path graph is built to surface.
      </p>

      <h2 className="mt-8 text-lg font-semibold tracking-tight">
        Give good introductions too
      </h2>
      <p className="mt-3 text-sm leading-relaxed text-foreground/70">
        Networks run on reciprocity. Forward the asks you genuinely believe in,
        and pass on the ones you do not, so your own vouch keeps its weight. A
        thoughtful introduction you make today is remembered when you need one.
      </p>

      <h2 className="mt-8 text-lg font-semibold tracking-tight">
        After the introduction
      </h2>
      <p className="mt-3 text-sm leading-relaxed text-foreground/70">
        Reply promptly, move your connector to bcc so their inbox stays quiet,
        and thank them. When the conversation reaches its outcome, close the
        loop with a short note back to the person who made it happen.
      </p>

      <p className="mt-10 text-xs text-muted-foreground">
        <Link href="/privacy" className="underline underline-offset-4">
          Privacy
        </Link>
        <span className="mx-1.5" aria-hidden>
          ·
        </span>
        <Link href="/terms" className="underline underline-offset-4">
          Terms
        </Link>
      </p>
    </main>
  );
}
