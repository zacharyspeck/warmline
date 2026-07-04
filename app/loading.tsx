// Route-transition loading fallback (App Router Suspense boundary). Client
// pages also render their own "Loading…" states from useQuery; this covers the
// server-render / navigation gap so a route change never flashes blank.
export default function Loading() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center px-6">
      <p className="text-sm text-muted-foreground">Loading…</p>
    </div>
  );
}
