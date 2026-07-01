import { getAuthUserId } from "@convex-dev/auth/server";
import { QueryCtx } from "./_generated/server";
import { Id } from "./_generated/dataModel";

// The current user's id, or throw. Use in every user-facing mutation and in any
// get-by-id query, so a signed-out or cross-user caller can never read or write
// another user's data. QueryCtx also covers MutationCtx and ActionCtx-run calls.
export async function requireUser(ctx: QueryCtx): Promise<Id<"users">> {
  const userId = await getAuthUserId(ctx);
  if (userId === null) throw new Error("Not authenticated");
  return userId;
}
