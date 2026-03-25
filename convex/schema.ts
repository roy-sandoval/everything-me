import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

const nodeLabelValidator = v.union(
  v.literal("source"),
  v.literal("note"),
  v.literal("experience"),
  v.literal("learning"),
  v.literal("realization"),
);

const nodeStatusValidator = v.union(v.literal("pending"), v.literal("active"));

export default defineSchema({
  nodes: defineTable({
    text: v.string(),
    label: v.optional(nodeLabelValidator),
    status: nodeStatusValidator,
    sourceUrl: v.optional(v.string()),
    sourceTitle: v.optional(v.string()),
    sourceParentId: v.optional(v.id("nodes")),
    x: v.number(),
    y: v.number(),
    createdAt: v.number(),
  }).index("by_status", ["status"]),
  connections: defineTable({
    from: v.id("nodes"),
    to: v.id("nodes"),
    createdAt: v.number(),
  })
    .index("by_from", ["from"])
    .index("by_to", ["to"]),
});
