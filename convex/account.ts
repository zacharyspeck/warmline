import { mutation, internalMutation, MutationCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { Id } from "./_generated/dataModel";
import { requireUser } from "./authz";
import { DEMO_EMAIL } from "./devSeed";

// Delete-my-data (Phase F). One call removes EVERY row belonging to the
// caller: all domain tables, the transitively scoped tables (personVectors
// and feedback hang off persons/icp), usage rows, and the auth rows
// (sessions, refresh tokens, accounts, verification codes, the users row).
//
// The purge runs as a safe ordered sequence: each mutation pass deletes a
// bounded batch inside one transaction; if a pass hits its bound, the tail is
// finished by a scheduled internal continuation carrying the userId
// explicitly (the session may already be gone by then). The users row goes
// LAST, only once everything else is empty.

// The exact phrase the settings page asks the caller to type. Checked
// server-side, so a bypassed client still can't delete on a whim.
export const CONFIRM_PHRASE = "delete my data";

// Rows deleted per transaction pass. Worlds are far smaller than this today;
// the continuation exists so a large account can never blow the transaction
// limits.
const PASS_BUDGET = 500;

// Delete the _storage blob behind a Convex storage serving URL. The avatar
// pipeline (avatars.ts storeAvatar) keeps ONLY the serving URL on the person
// row, and those URLs end in /api/storage/<storageId> — so the blob's id is
// recovered from the URL. External avatar URLs (seeded demo data, unavatar)
// don't match the pattern and are skipped.
async function deleteStorageFromUrl(
  ctx: MutationCtx,
  url: string | undefined,
): Promise<void> {
  if (!url) return;
  const match = url.match(/\/api\/storage\/([^/?#]+)/);
  if (!match) return;
  const storageId = match[1] as Id<"_storage">;
  const meta = await ctx.db.system.get(storageId);
  if (meta) await ctx.storage.delete(storageId);
}

// One bounded pass of the purge. Returns true when EVERYTHING (including the
// users row) is gone.
async function purgePass(
  ctx: MutationCtx,
  userId: Id<"users">,
): Promise<boolean> {
  let deleted = 0;
  const spent = () => deleted >= PASS_BUDGET;

  // Persons carry the transitively scoped rows: personVectors and feedback
  // have no userId and are reached ONLY through the owned person. A parent is
  // deleted only after its children are drained TO EXHAUSTION — if the budget
  // runs out mid-drain, the parent stays and the continuation re-finds it
  // (deleting it early would strand the tail with no index left to reach it).
  while (!spent()) {
    const persons = await ctx.db
      .query("persons")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .take(50);
    if (persons.length === 0) break;
    for (const p of persons) {
      if (spent()) return false;
      const vectors = await ctx.db
        .query("personVectors")
        .withIndex("by_person", (q) => q.eq("personId", p._id))
        .collect();
      for (const pv of vectors) {
        await ctx.db.delete(pv._id);
        deleted++;
      }
      for (;;) {
        const votes = await ctx.db
          .query("feedback")
          .withIndex("by_person", (q) => q.eq("personId", p._id))
          .take(100);
        if (votes.length === 0) break;
        for (const f of votes) {
          await ctx.db.delete(f._id);
          deleted++;
        }
        if (spent()) return false; // person survives for the continuation
      }
      // The person's cached avatar photo lives in _storage with no column
      // referencing it; recover it from the serving URL before the row goes.
      await deleteStorageFromUrl(ctx, p.avatarUrl);
      await ctx.db.delete(p._id);
      deleted++;
    }
  }

  // Connectors carry the user's raw uploaded export file (the most sensitive
  // artifact the app holds — a LinkedIn ZIP includes every contact's email
  // address). Delete the blob BEFORE the row, like connectors.disconnect does.
  while (!spent()) {
    const rows = await ctx.db
      .query("connectors")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .take(50);
    if (rows.length === 0) break;
    for (const c of rows) {
      if (c.storageId) await ctx.storage.delete(c.storageId);
      await ctx.db.delete(c._id);
      deleted++;
    }
  }

  // Feedback can also be reached through the owned icp (belt and braces for
  // rows whose person is already gone), then the icp rows themselves — same
  // drain-children-first rule as persons.
  while (!spent()) {
    const icps = await ctx.db
      .query("icp")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .take(20);
    if (icps.length === 0) break;
    for (const icp of icps) {
      if (spent()) return false;
      for (;;) {
        const votes = await ctx.db
          .query("feedback")
          .withIndex("by_icp", (q) => q.eq("icpId", icp._id))
          .take(100);
        if (votes.length === 0) break;
        for (const f of votes) {
          await ctx.db.delete(f._id);
          deleted++;
        }
        if (spent()) return false; // icp survives for the continuation
      }
      await ctx.db.delete(icp._id);
      deleted++;
    }
  }

  // Every remaining user-keyed table, straight off its by_user index (usage
  // via the by_user_and_day prefix, which sweeps ALL days). Connectors are
  // handled above because their storage blob must go first.
  type PurgeId = Id<
    | "recommendations"
    | "attendance"
    | "edges"
    | "events"
    | "usage"
    | "upgradeRequests"
    | "extensionTokens"
    | "companyDiscovery"
  >;
  const pagers: Array<() => Promise<Array<{ _id: PurgeId }>>> = [
    () =>
      ctx.db
        .query("recommendations")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .take(100),
    () =>
      ctx.db
        .query("attendance")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .take(100),
    () =>
      ctx.db
        .query("edges")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .take(100),
    () =>
      ctx.db
        .query("events")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .take(100),
    () =>
      ctx.db
        .query("usage")
        .withIndex("by_user_and_day", (q) => q.eq("userId", userId))
        .take(100),
    () =>
      ctx.db
        .query("upgradeRequests")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .take(100),
    () =>
      ctx.db
        .query("extensionTokens")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .take(100),
    () =>
      ctx.db
        .query("companyDiscovery")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .take(100),
  ];
  for (const nextPage of pagers) {
    while (!spent()) {
      const rows = await nextPage();
      if (rows.length === 0) break;
      for (const row of rows) {
        await ctx.db.delete(row._id);
        deleted++;
      }
    }
  }

  // Auth rows, children before parents, INSIDE the same budget: a long-lived
  // session accrues a refresh-token row per JWT refresh, so these page like
  // every other table and a spent budget hands the tail to the continuation.
  // (authVerifiers are transient OAuth handshake rows with no user/session
  // index and nothing for a password deployment; authRateLimits are expiring
  // throttle counters, not personal rows — neither holds account data.)
  while (!spent()) {
    const sessions = await ctx.db
      .query("authSessions")
      .withIndex("userId", (q) => q.eq("userId", userId))
      .take(25);
    if (sessions.length === 0) break;
    for (const s of sessions) {
      if (spent()) return false;
      for (;;) {
        const tokens = await ctx.db
          .query("authRefreshTokens")
          .withIndex("sessionId", (q) => q.eq("sessionId", s._id))
          .take(100);
        if (tokens.length === 0) break;
        for (const rt of tokens) {
          await ctx.db.delete(rt._id);
          deleted++;
        }
        if (spent()) return false; // session survives for the continuation
      }
      await ctx.db.delete(s._id);
      deleted++;
    }
  }
  while (!spent()) {
    const accounts = await ctx.db
      .query("authAccounts")
      .withIndex("userIdAndProvider", (q) => q.eq("userId", userId))
      .take(25);
    if (accounts.length === 0) break;
    for (const a of accounts) {
      if (spent()) return false;
      for (;;) {
        const codes = await ctx.db
          .query("authVerificationCodes")
          .withIndex("accountId", (q) => q.eq("accountId", a._id))
          .take(100);
        if (codes.length === 0) break;
        for (const c of codes) {
          await ctx.db.delete(c._id);
          deleted++;
        }
        if (spent()) return false; // account survives for the continuation
      }
      await ctx.db.delete(a._id);
      deleted++;
    }
  }

  // Nothing may have exited on budget above — otherwise the continuation
  // owns the rest. Only then does the users row go, last of all.
  if (spent()) return false;
  const user = await ctx.db.get(userId);
  if (user) await ctx.db.delete(userId);
  return true;
}

// Delete everything the signed-in caller owns. Requires the typed
// confirmation phrase; the demo account (the public logged-out demo's data
// owner) can never be deleted through this path.
export const deleteMyData = mutation({
  args: { confirm: v.string() },
  returns: v.object({ done: v.boolean() }),
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    if (args.confirm !== CONFIRM_PHRASE) {
      throw new Error("Confirmation phrase does not match");
    }
    const user = await ctx.db.get(userId);
    if (user?.email && user.email.trim().toLowerCase() === DEMO_EMAIL) {
      throw new Error("This account cannot be deleted");
    }
    const done = await purgePass(ctx, userId);
    if (!done) {
      await ctx.scheduler.runAfter(0, internal.account.purgeRemaining, {
        userId,
      });
    }
    return { done };
  },
});

// Scheduled continuation for accounts too large for one pass. Internal only;
// carries the owner explicitly because the caller's session may already be
// deleted by the time it runs.
export const purgeRemaining = internalMutation({
  args: { userId: v.id("users") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const done = await purgePass(ctx, args.userId);
    if (!done) {
      await ctx.scheduler.runAfter(0, internal.account.purgeRemaining, {
        userId: args.userId,
      });
    }
    return null;
  },
});
