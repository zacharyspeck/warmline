import type { Metadata } from "next";

// The goals editor is a client component, so its route metadata lives here.
export const metadata: Metadata = {
  title: "Your goal · Warmline",
  description: "Edit the goal your Warmline feed ranks people against.",
};

export default function GoalsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
