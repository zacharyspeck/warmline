"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useQuery } from "convex/react";
import { useAuthActions } from "@convex-dev/auth/react";
import { api } from "@/convex/_generated/api";
import { SignupPrompt } from "@/components/signup-prompt";
import {
  Link2Icon,
  SettingsIcon,
  TargetIcon,
  ZapIcon,
} from "@/components/icons";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarHeader,
  SidebarItem,
} from "@/components/ui/sidebar";
import { WarmlineLockup } from "@/components/warmline-mark";

// App shell (S3): the dark velvet rail with iconed nav and the identity
// block pinned to the footer. Full-screen routes (onboarding, sign in, the
// public doc pages) render without it.
//
// `authed` is the SERVER's auth branch (the request cookie), so the nav is
// stable from the first paint — it never flickers while api.auth.currentUser
// resolves. The client query is only used for the footer identity block.
//
// Responsive: the rail shows at md+ (desktop unchanged); below md it collapses
// to a top bar + a slide-over drawer that reuses the exact same nav items and
// footer in the same tokens.
export default function AppChrome({
  authed,
  children,
}: {
  authed: boolean;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const me = useQuery(api.auth.currentUser);
  const { signOut } = useAuthActions();
  // Signed-out shell: nav items open the same sign-up prompt the demo feed's
  // vote buttons use, instead of navigating or bouncing off /signin.
  const [signupOpen, setSignupOpen] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  const menuBtnRef = useRef<HTMLButtonElement>(null);
  const drawerRef = useRef<HTMLDivElement>(null);

  // Mobile drawer keyboard access: focus into the drawer on open, trap Tab
  // within it, close on Escape, and restore focus to the menu button on close.
  useEffect(() => {
    if (!navOpen) return;
    const drawer = drawerRef.current;
    const trigger = menuBtnRef.current; // capture for the cleanup
    const focusables = () =>
      Array.from(
        drawer?.querySelectorAll<HTMLElement>(
          'button, [href], input, [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      );
    focusables()[0]?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setNavOpen(false);
        return;
      }
      if (e.key !== "Tab") return;
      const list = focusables();
      if (list.length === 0) return;
      const first = list[0];
      const last = list[list.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      trigger?.focus();
    };
  }, [navOpen]);

  if (
    pathname === "/onboarding" ||
    pathname === "/signin" ||
    pathname === "/privacy" ||
    pathname === "/terms" ||
    pathname === "/pricing" ||
    pathname.startsWith("/compare") ||
    pathname.startsWith("/guides")
  )
    return <>{children}</>;

  // The nav item's action: navigate when signed in, else open the sign-up
  // prompt. `after` closes the mobile drawer when it fired from there.
  const go = (path: string, after?: () => void) => {
    if (authed) router.push(path);
    else setSignupOpen(true);
    after?.();
  };

  const navItems = (after?: () => void) => (
    <SidebarGroup>
      <SidebarItem
        icon={<ZapIcon />}
        label="Who to reach out to"
        active={pathname === "/"}
        onClick={() => go("/", after)}
      />
      <SidebarItem
        icon={<Link2Icon />}
        label="Connectors"
        active={pathname === "/connectors"}
        onClick={() => go("/connectors", after)}
      />
      <SidebarItem
        icon={<TargetIcon />}
        label="Goals"
        active={pathname === "/goals"}
        onClick={() => go("/goals", after)}
      />
    </SidebarGroup>
  );

  const footer = (after?: () => void) =>
    me ? (
      <div className="flex items-center gap-2 px-2 py-1">
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-medium text-foreground">
            {me.email ?? "Signed in"}
          </p>
          <button
            type="button"
            onClick={() =>
              void signOut().then(() => {
                // Re-render the server tree so "/" swaps to the demo landing.
                router.refresh();
              })
            }
            className="text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            Sign out
          </button>
        </div>
        <button
          type="button"
          aria-label="Settings"
          onClick={() => {
            router.push("/settings");
            after?.();
          }}
          className={
            pathname === "/settings"
              ? "rounded-md p-1.5 text-foreground [background-image:var(--velour-raised)]"
              : "rounded-md p-1.5 text-muted-foreground transition-colors hover:text-foreground"
          }
        >
          <SettingsIcon className="size-4" />
        </button>
      </div>
    ) : me === null ? (
      // Signed out (the demo landing): offer the way in.
      <button
        type="button"
        onClick={() => {
          router.push("/signin");
          after?.();
        }}
        className="px-3 py-1 text-left text-sm text-foreground/60 transition-colors hover:text-foreground"
      >
        Sign in
      </button>
    ) : (
      <p className="px-3 py-1 text-sm text-foreground/60">Refreshed daily</p>
    );

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Desktop rail (md+); pixel-identical to before at those widths. */}
      <Sidebar className="hidden shrink-0 md:flex">
        <SidebarHeader>
          <WarmlineLockup />
        </SidebarHeader>
        <SidebarContent>{navItems()}</SidebarContent>
        <SidebarFooter>{footer()}</SidebarFooter>
      </Sidebar>

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {/* Mobile top bar (below md). */}
        <div className="flex h-14 shrink-0 items-center justify-between border-b border-border px-4 [background-image:var(--velour)] md:hidden">
          <WarmlineLockup />
          <button
            ref={menuBtnRef}
            type="button"
            aria-label="Open menu"
            aria-expanded={navOpen}
            onClick={() => setNavOpen(true)}
            className="rounded-md p-2 text-muted-foreground transition-colors hover:text-foreground"
          >
            <span className="flex flex-col gap-[3px]" aria-hidden>
              <span className="block h-0.5 w-5 rounded-full bg-current" />
              <span className="block h-0.5 w-5 rounded-full bg-current" />
              <span className="block h-0.5 w-5 rounded-full bg-current" />
            </span>
          </button>
        </div>
        <div className="flex-1 overflow-y-auto">{children}</div>
      </div>

      {/* Mobile nav drawer (below md). */}
      {navOpen && (
        <div
          className="fixed inset-0 z-50 md:hidden"
          role="dialog"
          aria-modal="true"
          aria-label="Navigation"
        >
          <div
            className="absolute inset-0 bg-black/50"
            onClick={() => setNavOpen(false)}
          />
          <div
            ref={drawerRef}
            className="absolute left-0 top-0 flex h-full w-64 flex-col border-r border-border [background-image:var(--velour)]"
          >
            <div className="flex h-14 shrink-0 items-center justify-between border-b border-border px-4">
              <WarmlineLockup />
              <button
                type="button"
                aria-label="Close menu"
                onClick={() => setNavOpen(false)}
                className="rounded-md px-2 text-lg leading-none text-muted-foreground transition-colors hover:text-foreground"
              >
                <span aria-hidden>×</span>
              </button>
            </div>
            <div className="flex flex-1 flex-col gap-1 overflow-y-auto p-2">
              {navItems(() => setNavOpen(false))}
            </div>
            <div className="border-t border-border p-2">
              {footer(() => setNavOpen(false))}
            </div>
          </div>
        </div>
      )}

      {!authed && (
        <SignupPrompt open={signupOpen} onOpenChange={setSignupOpen} />
      )}
    </div>
  );
}
