"use client";

import { usePathname, useRouter } from "next/navigation";
import { useQuery } from "convex/react";
import { useAuthActions } from "@convex-dev/auth/react";
import { api } from "@/convex/_generated/api";
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
export default function AppChrome({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const me = useQuery(api.auth.currentUser);
  const { signOut } = useAuthActions();

  if (
    pathname === "/onboarding" ||
    pathname === "/signin" ||
    pathname === "/privacy" ||
    pathname === "/terms" ||
    pathname === "/pricing"
  )
    return <>{children}</>;

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar className="shrink-0">
        <SidebarHeader>
          <WarmlineLockup />
        </SidebarHeader>
        <SidebarContent>
          <SidebarGroup>
            <SidebarItem
              icon={<ZapIcon />}
              label="Who to reach out to"
              active={pathname === "/"}
              onClick={() => router.push("/")}
            />
            {me ? (
              <>
                <SidebarItem
                  icon={<Link2Icon />}
                  label="Connectors"
                  active={pathname === "/connectors"}
                  onClick={() => router.push("/connectors")}
                />
                <SidebarItem
                  icon={<TargetIcon />}
                  label="Goals"
                  active={pathname === "/onboarding"}
                  onClick={() => router.push("/onboarding")}
                />
              </>
            ) : null}
          </SidebarGroup>
        </SidebarContent>
        <SidebarFooter>
          {me ? (
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
                onClick={() => router.push("/settings")}
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
              onClick={() => router.push("/signin")}
              className="px-3 py-1 text-left text-sm text-foreground/60 transition-colors hover:text-foreground"
            >
              Sign in
            </button>
          ) : (
            <p className="px-3 py-1 text-sm text-foreground/60">Refreshed daily</p>
          )}
        </SidebarFooter>
      </Sidebar>

      <div className="flex-1 overflow-y-auto">{children}</div>
    </div>
  );
}
