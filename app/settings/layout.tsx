import type { Metadata } from "next";

// The settings page is a client component, so its route metadata lives here.
export const metadata: Metadata = {
  title: "Settings · Warmline",
  description: "Manage your Warmline account, plan, and data.",
};

export default function SettingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
