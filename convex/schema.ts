import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  entries: defineTable({
    content: v.string(),
    type: v.string(),
    metadata: v.optional(
      v.object({
        title: v.optional(v.string()),
        description: v.optional(v.string()),
        image: v.optional(v.string()),
        url: v.optional(v.string()),
        scrapeStatus: v.optional(
          v.union(
            v.literal("pending"),
            v.literal("success"),
            v.literal("failed"),
          ),
        ),
        scrapedAt: v.optional(v.number()),
      }),
    ),
  }).index("by_type", ["type"]),
});
