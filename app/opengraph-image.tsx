import { ImageResponse } from "next/og";

// The share card, drawn from the brand tokens directly: charcoal ground,
// the amber three-node W, off-white wordmark. Applies to every route that
// doesn't define its own.
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = "Warmline. The For You feed for your warm network";

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 26,
          background: "#1B1613",
        }}
      >
        <svg width="132" height="132" viewBox="0 0 64 64" fill="none">
          <path
            d="M11 18 L22 46 L32 27 L42 46 L53 18"
            fill="none"
            stroke="#E5813B"
            strokeWidth="6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <circle cx="11" cy="18" r="5.6" fill="#E5813B" />
          <circle cx="32" cy="27" r="5.6" fill="#E5813B" />
          <circle cx="53" cy="18" r="5.6" fill="#E5813B" />
        </svg>
        <div
          style={{
            color: "#F3EBE1",
            fontSize: 76,
            fontWeight: 700,
            letterSpacing: -3,
          }}
        >
          Warmline
        </div>
        <div style={{ color: "#B5A28E", fontSize: 32 }}>
          The For You feed for your warm network
        </div>
      </div>
    ),
    size,
  );
}
