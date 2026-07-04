import { ImageResponse } from "next/og";

// Apple touch icon (iOS home screen / Safari): the brand W mark in charcoal on
// the amber rounded square, matching app/icon.svg. Safari doesn't use the SVG
// favicon as a touch icon, so this PNG is generated from the same mark.
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#E5813B",
          borderRadius: 40,
        }}
      >
        <svg width="120" height="120" viewBox="0 0 64 64" fill="none">
          <path
            d="M11 18 L22 46 L32 27 L42 46 L53 18"
            stroke="#1B1613"
            strokeWidth="6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <circle cx="11" cy="18" r="5.6" fill="#1B1613" />
          <circle cx="32" cy="27" r="5.6" fill="#1B1613" />
          <circle cx="53" cy="18" r="5.6" fill="#1B1613" />
        </svg>
      </div>
    ),
    size,
  );
}
