import { readdirSync, readFileSync, statSync } from "fs";
import { join, relative } from "path";
import { zipSync } from "fflate";

// Serves the browser extension as a zip the user can unzip and load unpacked.
// Reads the repo's extension/ folder (bundled in production via
// next.config.ts outputFileTracingIncludes). Public: no user data here.
export const runtime = "nodejs";

function collect(
  dir: string,
  base: string,
  out: Record<string, Uint8Array>,
): void {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      collect(full, base, out);
    } else {
      const rel = relative(base, full).split("\\").join("/");
      out[rel] = new Uint8Array(readFileSync(full));
    }
  }
}

export function GET() {
  const dir = join(process.cwd(), "extension");
  const files: Record<string, Uint8Array> = {};
  try {
    collect(dir, dir, files);
  } catch {
    return new Response("extension bundle unavailable", { status: 500 });
  }
  const zip = zipSync(files);
  return new Response(zip, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": 'attachment; filename="warmline-extension.zip"',
      "Cache-Control": "no-store",
    },
  });
}
