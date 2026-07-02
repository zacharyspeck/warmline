"use client";

import { usePathname, useRouter } from "next/navigation";
import { useQuery } from "convex/react";
import { useAuthActions } from "@convex-dev/auth/react";
import { api } from "@/convex/_generated/api";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarHeader,
  SidebarItem,
} from "@/components/ui/sidebar";
import { WarmlineLockup } from "@/components/warmline-mark";

// App shell: the sidebar lives here so it's present on every page.
// Full-screen routes (onboarding, sign in) render without it.
export default function AppChrome({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const me = useQuery(api.auth.currentUser);
  const { signOut } = useAuthActions();

  if (
    pathname === "/onboarding" ||
    pathname === "/signin" ||
    pathname === "/privacy" ||
    pathname === "/terms"
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
              label="Feed"
              active={pathname === "/"}
              onClick={() => router.push("/")}
            />
            {me ? (
              <>
                <SidebarItem
                  label="Connectors"
                  active={pathname === "/connectors"}
                  onClick={() => router.push("/connectors")}
                />
                <SidebarItem
                  label="Onboarding"
                  active={pathname === "/onboarding"}
                  onClick={() => router.push("/onboarding")}
                />
                <SidebarItem
                  label="Settings"
                  active={pathname === "/settings"}
                  onClick={() => router.push("/settings")}
                />
              </>
            ) : null}
          </SidebarGroup>
        </SidebarContent>
        <SidebarFooter>
          {me ? (
            <div className="flex flex-col gap-0.5 px-3 py-1">
              <span className="truncate text-xs text-muted-foreground">
                {me.email ?? "Signed in"}
              </span>
              <button
                type="button"
                onClick={() =>
                  void signOut().then(() => {
                    // Re-render the server tree so "/" swaps to the demo landing.
                    router.refresh();
                  })
                }
                className="text-left text-sm text-foreground/60 transition-colors hover:text-foreground"
              >
                Sign out
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
