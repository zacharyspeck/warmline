"use client";

import { useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

// The Extension card (task: revive the extension). Mints a scoped token the
// user pastes into the browser extension. The raw token is shown ONCE, right
// after minting; only its hash is stored, so it can be regenerated but never
// re-read.
export function ExtensionSettingsCard() {
  const status = useQuery(api.extensionAuth.status, {});
  const generateToken = useAction(api.extensionAuth.generateToken);
  const revokeToken = useMutation(api.extensionAuth.revokeToken);
  const [token, setToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  // The deployment's HTTP origin the extension posts to (Convex serves HTTP
  // routes from *.convex.site).
  const serverUrl = process.env.NEXT_PUBLIC_CONVEX_SITE_URL ?? "";

  const connected = status?.connected ?? false;

  async function mint() {
    setBusy(true);
    setCopied(false);
    try {
      const res = await generateToken({});
      setToken(res.token);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="mt-6">
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <CardTitle>Browser extension</CardTitle>
          {status ? (
            <Badge variant={connected ? "success" : "secondary"}>
              {connected ? "Connected" : "Not connected"}
            </Badge>
          ) : null}
        </div>
        <CardDescription>
          Capture LinkedIn profiles and their mutual connections from profiles
          you open, in your own session. Everything you capture lands only in
          your graph
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <ol className="flex flex-col gap-2 text-sm text-muted-foreground">
          <li>
            1. Install the Warmline extension (unpacked) from the{" "}
            <Link
              href="/connectors"
              className="font-medium text-primary underline-offset-4 hover:underline"
            >
              Connectors page
            </Link>
          </li>
          <li>2. Open the extension and paste the server URL and token below</li>
          <li>
            3. On a LinkedIn profile you are viewing, click Capture in the
            extension
          </li>
        </ol>

        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium uppercase tracking-[0.1em] text-muted-foreground/70">
            Server URL
          </label>
          <Input readOnly value={serverUrl} onFocus={(e) => e.currentTarget.select()} />
        </div>

        {token ? (
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium uppercase tracking-[0.1em] text-muted-foreground/70">
              Your token (shown once, copy it now)
            </label>
            <div className="flex gap-2">
              <Input
                readOnly
                value={token}
                onFocus={(e) => e.currentTarget.select()}
                className="font-mono text-xs"
              />
              <Button
                variant="outline"
                onClick={() => {
                  void navigator.clipboard.writeText(token).then(() => {
                    setCopied(true);
                    setTimeout(() => setCopied(false), 1600);
                  });
                }}
              >
                {copied ? "Copied" : "Copy"}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              We store only a hash of this token, so it cannot be shown again.
              Regenerate any time
            </p>
          </div>
        ) : null}

        <div className="flex flex-wrap items-center gap-3">
          <Button variant="primary" onClick={() => void mint()} disabled={busy}>
            {busy
              ? "Generating…"
              : connected
                ? "Regenerate token"
                : "Generate token"}
          </Button>
          {connected ? (
            <button
              type="button"
              onClick={() => {
                void revokeToken({});
                setToken(null);
              }}
              className="text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              Disconnect
            </button>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
