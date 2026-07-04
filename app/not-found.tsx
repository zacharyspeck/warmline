import Link from "next/link";
import { Button } from "@/components/ui/button";

// A calm 404 in the brand tokens instead of the default Next.js page.
export default function NotFound() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 px-6 text-center">
      <h2 className="font-display text-xl font-semibold text-foreground">
        Page not found
      </h2>
      <p className="max-w-sm text-sm text-muted-foreground">
        That page does not exist or has moved
      </p>
      <Button variant="primary" asChild>
        <Link href="/">Back to Warmline</Link>
      </Button>
    </div>
  );
}
