// OAuth config for data-source connectors (Google contacts/calendar, Outlook
// contacts). These are SEPARATE from app login — they capture permission to
// read a network, not to sign in. Scopes stay least-privilege: /privacy
// promises Warmline never reads messages, so no mail scope is requested.
//
// SCAFFOLD: the flow is fully coded but untested — it needs a real OAuth app.
// Create one in your own console (you must do this; secrets can't be handled
// for you) and set the env vars below on the Convex/Next deployment:
//   GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET
//   MICROSOFT_OAUTH_CLIENT_ID / MICROSOFT_OAUTH_CLIENT_SECRET
// Redirect URI to register: <origin>/api/connectors/<provider>/callback

export type OauthProviderId = "google" | "outlook";

export type OauthProviderConfig = {
  authorizeUrl: string;
  tokenUrl: string;
  /** Endpoint returning the account's email, + how to read it from the JSON. */
  userInfoUrl: string;
  emailField: (json: Record<string, unknown>) => string | undefined;
  scopes: string[];
  clientIdEnv: string;
  clientSecretEnv: string;
  /** Extra authorize params (e.g. Google needs these for a refresh token). */
  extraAuthParams?: Record<string, string>;
};

export const OAUTH_PROVIDERS: Record<OauthProviderId, OauthProviderConfig> = {
  google: {
    authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    userInfoUrl: "https://openidconnect.googleapis.com/v1/userinfo",
    emailField: (j) => (typeof j.email === "string" ? j.email : undefined),
    scopes: [
      "openid",
      "email",
      "https://www.googleapis.com/auth/contacts.readonly",
      "https://www.googleapis.com/auth/calendar.readonly",
    ],
    clientIdEnv: "GOOGLE_OAUTH_CLIENT_ID",
    clientSecretEnv: "GOOGLE_OAUTH_CLIENT_SECRET",
    extraAuthParams: { access_type: "offline", prompt: "consent" },
  },
  outlook: {
    authorizeUrl:
      "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
    tokenUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/token",
    userInfoUrl: "https://graph.microsoft.com/v1.0/me",
    emailField: (j) =>
      (typeof j.mail === "string" && j.mail) ||
      (typeof j.userPrincipalName === "string" ? j.userPrincipalName : undefined),
    scopes: ["openid", "email", "offline_access", "Contacts.Read"],
    clientIdEnv: "MICROSOFT_OAUTH_CLIENT_ID",
    clientSecretEnv: "MICROSOFT_OAUTH_CLIENT_SECRET",
  },
};

export function isOauthProvider(p: string): p is OauthProviderId {
  return p === "google" || p === "outlook";
}

export function redirectUri(origin: string, provider: OauthProviderId): string {
  return `${origin}/api/connectors/${provider}/callback`;
}
