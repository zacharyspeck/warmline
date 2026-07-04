import type { Metadata } from "next";

// The connectors page is a client component, so its route metadata lives here.
export const metadata: Metadata = {
  title: "Connectors · Warmline",
  description:
    "Connect the sources Warmline reads your warm network from. Only you can search what you add.",
};

export default function ConnectorsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
