"use client";

import { usePathname, useRouter } from "next/navigation";
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
// Hidden on the onboarding screen.
export default function AppChrome({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();

  if (pathname === "/onboarding") return <>{children}</>;

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
          </SidebarGroup>
        </SidebarContent>
        <SidebarFooter>
          <p className="px-3 py-1 text-sm text-foreground/60">
            Refreshed daily
          </p>
        </SidebarFooter>
      </Sidebar>

      <div className="flex-1 overflow-y-auto">{children}</div>
    </div>
  );
}
