import { Password } from "@convex-dev/auth/providers/Password";
import { convexAuth, getAuthUserId } from "@convex-dev/auth/server";
import { query } from "./_generated/server";
import { v } from "convex/values";

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [Password],
});

// The signed-in user's stable id + email, exposed to the client. Null when
// signed out. getAuthUserId(ctx) is the canonical server-side stable user id
// (Id<"users">) that Phase B scopes every table by.
export const currentUser = query({
  args: {},
  returns: v.union(
    v.object({
      id: v.id("users"),
      email: v.union(v.string(), v.null()),
    }),
    v.null(),
  ),
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return null;
    const user = await ctx.db.get("users", userId);
    return { id: userId, email: user?.email ?? null };
  },
});
