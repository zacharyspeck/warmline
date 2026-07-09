import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "edge-runtime",
    include: ["convex/**/*.test.ts", "extension/**/*.test.ts"],
    server: { deps: { inline: ["convex-test"] } },
  },
});
