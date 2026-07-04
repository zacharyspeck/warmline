"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";

// App-wide error boundary: catches a render/query error from any route under
// app/ (a thrown Convex query, a bad state) so a Convex hiccup shows a calm
// retry instead of a white screen. reset() re-renders the segment.
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Route error boundary caught:", error);
  }, [error]);

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 px-6 text-center">
      <h2 className="font-display text-xl font-semibold text-foreground">
        Something went wrong
      </h2>
      <p className="max-w-sm text-sm text-muted-foreground">
        A hiccup on our end. This is usually temporary, so try again in a moment
      </p>
      <Button variant="primary" onClick={reset}>
        Try again
      </Button>
    </div>
  );
}
