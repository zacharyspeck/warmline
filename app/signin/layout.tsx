import type { Metadata } from "next";

// The signin page is a client component, so its route metadata lives here.
export const metadata: Metadata = {
  title: "Sign in · Warmline",
  description:
    "Sign in to your warm network, or create an invite-only Warmline account.",
};

export default function SignInLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
