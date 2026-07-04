import type { Metadata } from "next";
import Link from "next/link";

// DRAFT, unlinked and noindex until the owner's voice pass (see MANUAL_TODO).
// Copy rules: no em dashes, no this-not-that constructions, bullets and labels
// carry no trailing period. Factual and generous about Happenstance; honest
// about Warmline's current beta state.
export const metadata: Metadata = {
  title: "Warmline and Happenstance · Warmline",
  description:
    "How Warmline's proactive warm-network feed compares to Happenstance's AI network search.",
  robots: { index: false, follow: false },
};

export default function CompareHappenstance() {
  return (
    <main className="mx-auto w-full max-w-2xl px-6 py-12">
      <Link
        href="/"
        className="text-sm font-semibold tracking-tight text-foreground/80 hover:text-foreground"
      >
        Warmline
      </Link>
      <h1 className="mt-6 font-display text-2xl font-semibold tracking-tight">
        Warmline and Happenstance
      </h1>
      <p className="mt-3 text-sm leading-relaxed text-foreground/70">
        Both tools help you turn the network you already have into warm
        introductions, and they take different shapes. This page lays out how,
        in plain terms. It is generous about Happenstance, which is a genuinely
        good product that a lot of people rely on.
      </p>

      <h2 className="mt-8 text-lg font-semibold tracking-tight">
        What Happenstance does
      </h2>
      <p className="mt-3 text-sm leading-relaxed text-foreground/70">
        Happenstance is AI search over your network. It connects sources like
        Gmail, LinkedIn, Outlook, Twitter, Instagram, and your calendar, then
        lets you ask in plain language, for example a machine learning engineer
        at a venture-backed startup, and it surfaces the people who fit along
        with the warm paths to reach them. Matches are shown with a clear
        color-coded confidence, and you can share your network with people you
        trust so your search also reaches their connections. It is fast,
        well-designed, and popular with founders, recruiters, and sales teams.
      </p>

      <h2 className="mt-8 text-lg font-semibold tracking-tight">
        What Warmline does
      </h2>
      <p className="mt-3 text-sm leading-relaxed text-foreground/70">
        Warmline is a For You feed for your warm network. You state a goal once,
        and Warmline ranks the people worth reaching out to against that goal,
        with short bullets on why each one fits and the warmest path to an
        intro, refreshed on a daily run. It drafts an opener for you to send
        yourself, and it never sends anything for you.
      </p>
      <p className="mt-3 text-sm leading-relaxed text-foreground/70">
        Warmline is an invite-only beta. Today it reads your network from a
        LinkedIn export you upload, with more sources on the way.
      </p>

      <h2 className="mt-8 text-lg font-semibold tracking-tight">
        Three ways they differ
      </h2>
      <div className="mt-4 flex flex-col gap-5">
        <div>
          <p className="text-sm font-semibold text-foreground">
            Proactive by default
          </p>
          <p className="mt-1 text-sm leading-relaxed text-foreground/70">
            Happenstance answers the question you bring it. Warmline brings you
            the answer before you ask, ranking who to reach out to for your goal
            so you see people you would not have thought to search for.
          </p>
        </div>
        <div>
          <p className="text-sm font-semibold text-foreground">
            Multi-degree warm paths
          </p>
          <p className="mt-1 text-sm leading-relaxed text-foreground/70">
            Both map the path from you to a person through the people in
            between. Warmline centers that graph. It shows you, the connectors
            who bridge you, and how many doors each connector opens, so you can
            tell which single introduction unlocks the most.
          </p>
        </div>
        <div>
          <p className="text-sm font-semibold text-foreground">
            Ranking that learns from your thumbs
          </p>
          <p className="mt-1 text-sm leading-relaxed text-foreground/70">
            Every thumbs up or down on a Warmline card nudges your goal, so the
            next day&rsquo;s feed leans toward the people you actually want to
            meet.
          </p>
        </div>
      </div>

      <h2 className="mt-8 text-lg font-semibold tracking-tight">
        Which to use
      </h2>
      <p className="mt-3 text-sm leading-relaxed text-foreground/70">
        If you like to drive the search yourself, Happenstance is excellent and
        worth your time. If you would rather open an app and see who to reach
        out to today, that is what Warmline is for. Plenty of people will happily
        use both.
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
