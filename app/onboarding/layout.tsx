import type { Metadata } from "next";

// The onboarding page is a client component, so its route metadata lives here.
export const metadata: Metadata = {
  title: "Get started · Warmline",
  description:
    "Set your goal and connect your network to build your Warmline feed.",
};

export default function OnboardingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
