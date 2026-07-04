"use client";

import { useEffect } from "react";

// Last-resort boundary for errors thrown in the ROOT layout itself (which the
// segment error.tsx can't catch). It replaces the whole document, so it uses
// inline brand-token styles rather than Tailwind, and renders its own html/body.
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Global error boundary caught:", error);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 16,
          background: "#1B1613",
          color: "#F3EBE1",
          fontFamily:
            "ui-sans-serif, system-ui, -apple-system, sans-serif",
          textAlign: "center",
          padding: "0 24px",
        }}
      >
        <h2 style={{ fontSize: 22, fontWeight: 600, margin: 0 }}>
          Something went wrong
        </h2>
        <p style={{ fontSize: 14, color: "#B5A28E", maxWidth: 360, margin: 0 }}>
          A hiccup on our end. Reload to try again
        </p>
        <button
          type="button"
          onClick={reset}
          style={{
            marginTop: 8,
            padding: "8px 16px",
            borderRadius: 10,
            border: "none",
            background: "#E5813B",
            color: "#1B1613",
            fontWeight: 600,
            fontSize: 14,
            cursor: "pointer",
          }}
        >
          Try again
        </button>
      </body>
    </html>
  );
}
