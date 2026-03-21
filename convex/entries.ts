import { v } from "convex/values";

import { mutation, query } from "./_generated/server";

function detectEntryType(content: string) {
  return /^https?:\/\//i.test(content) ? "link" : "thought";
}

export const list = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("entries").order("desc").take(20);
  },
});

export const create = mutation({
  args: {
    content: v.string(),
  },
  handler: async (ctx, args) => {
    const content = args.content.trim();

    if (!content) {
      throw new Error("Content is required.");
    }

    const type = detectEntryType(content);

    return await ctx.db.insert("entries", {
      content,
      type,
      metadata: type === "link" ? { url: content } : undefined,
    });
  },
});
