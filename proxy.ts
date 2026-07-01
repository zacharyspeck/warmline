import { convexAuthNextjsMiddleware } from "@convex-dev/auth/nextjs/server";

// Auth is dormant for this phase: the public demo has no login. The middleware
// still mounts (so it is ready for Phase 2), but its handler is a no-op, so it
// gates nothing and no route redirects to /signin. Do not delete — restore the
// route gate in the Phase 2 block below when auth is wired up.
export default convexAuthNextjsMiddleware(async () => {
  // no-op: let every request through
});

export const config = {
  // Runs on all routes except static assets.
  matcher: ["/((?!.*\\..*|_next).*)", "/", "/(api|trpc)(.*)"],
};

/* Phase 2 — restore the auth gate:

import {
  convexAuthNextjsMiddleware,
  createRouteMatcher,
  nextjsMiddlewareRedirect,
} from "@convex-dev/auth/nextjs/server";

const isSignInPage = createRouteMatcher(["/signin"]);
const isProtectedRoute = createRouteMatcher(["/", "/server"]);

export default convexAuthNextjsMiddleware(async (request, { convexAuth }) => {
  if (isSignInPage(request) && (await convexAuth.isAuthenticated())) {
    return nextjsMiddlewareRedirect(request, "/");
  }
  if (isProtectedRoute(request) && !(await convexAuth.isAuthenticated())) {
    return nextjsMiddlewareRedirect(request, "/signin");
  }
});
*/
