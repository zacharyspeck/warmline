import {
  convexAuthNextjsMiddleware,
  createRouteMatcher,
  nextjsMiddlewareRedirect,
} from "@convex-dev/auth/nextjs/server";

// Auth gate (Next.js 16 middleware lives in proxy.ts). "/" is public: signed-out
// visitors get the read-only demo landing (app/page.tsx branches server-side),
// signed-in users their own feed. Signed-out visitors on any other app route are
// sent to /signin; a signed-in visitor on /signin is sent to the feed.
const isSignInPage = createRouteMatcher(["/signin"]);
const isProtectedRoute = createRouteMatcher([
  "/server",
  "/onboarding",
  "/connectors",
]);

export default convexAuthNextjsMiddleware(async (request, { convexAuth }) => {
  if (isSignInPage(request) && (await convexAuth.isAuthenticated())) {
    return nextjsMiddlewareRedirect(request, "/");
  }
  if (isProtectedRoute(request) && !(await convexAuth.isAuthenticated())) {
    return nextjsMiddlewareRedirect(request, "/signin");
  }
});

export const config = {
  // Runs on all routes except static assets.
  matcher: ["/((?!.*\\..*|_next).*)", "/", "/(api|trpc)(.*)"],
};
