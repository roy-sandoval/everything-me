import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

const nodeLabelValidator = v.union(
  v.literal("source"),
  v.literal("note"),
  v.literal("experience"),
  v.literal("learning"),
  v.literal("realization"),
);

export default defineSchema({
  nodes: defineTable({
    text: v.string(),
    label: v.optional(nodeLabelValidator),
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
