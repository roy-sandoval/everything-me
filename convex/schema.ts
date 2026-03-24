import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  nodes: defineTable({
    text: v.string(),
    x: v.number(),
    y: v.number(),
    createdAt: v.number(),
  }),
  connections: defineTable({
    from: v.id("nodes"),
    to: v.id("nodes"),
    createdAt: v.number(),
  })
    .index("by_from", ["from"])
    .index("by_to", ["to"]),
});
