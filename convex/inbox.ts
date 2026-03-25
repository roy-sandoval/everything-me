import { v } from "convex/values";

import type { Id } from "./_generated/dataModel";
import { mutation, query } from "./_generated/server";
import { nodeLabelValidator } from "./graph";

const MAX_PENDING_NODES = 100;
const FALLBACK_NODE_WIDTH = 224;
const FALLBACK_NODE_HEIGHT = 96;

function getActivationOffset(seed: string) {
  let hash = 0;

  for (let index = 0; index < seed.length; index += 1) {
    hash = (hash * 31 + seed.charCodeAt(index)) >>> 0;
  }

  const angle = ((hash % 360) * Math.PI) / 180;
  const radius = 180 + (hash % 4) * 18;

  return {
    x: Math.round(Math.cos(angle) * radius),
    y: Math.round(Math.sin(angle) * radius),
  };
}

export const listPending = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db
      .query("nodes")
      .withIndex("by_status", (q) => q.eq("status", "pending"))
      .take(MAX_PENDING_NODES);
  },
});

export const createPendingNode = mutation({
  args: {
    text: v.string(),
    label: nodeLabelValidator,
    sourceUrl: v.optional(v.string()),
    sourceTitle: v.optional(v.string()),
    createdAt: v.number(),
  },
  returns: v.id("nodes"),
  handler: async (ctx, args) => {
    const text = args.text.trim();

    if (!text) {
      throw new Error("Text is required.");
    }

    return await ctx.db.insert("nodes", {
      text,
      label: args.label,
      status: "pending",
      sourceUrl: args.sourceUrl?.trim() || undefined,
      sourceTitle: args.sourceTitle?.trim() || undefined,
      x: 0,
      y: 0,
      createdAt: args.createdAt,
    });
  },
});

export const dismissPendingNode = mutation({
  args: {
    nodeId: v.id("nodes"),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const node = await ctx.db.get(args.nodeId);

    if (!node) {
      return null;
    }

    if (node.status !== "pending") {
      throw new Error("Only pending nodes can be dismissed.");
    }

    await ctx.db.delete(args.nodeId);

    return null;
  },
});

export const activatePendingNode = mutation({
  args: {
    nodeId: v.id("nodes"),
    connectToNodeId: v.union(v.id("nodes"), v.null()),
    viewportCenterX: v.number(),
    viewportCenterY: v.number(),
  },
  returns: v.object({
    activatedNodeId: v.id("nodes"),
    x: v.number(),
    y: v.number(),
  }),
  handler: async (ctx, args) => {
    const node = await ctx.db.get(args.nodeId);

    if (!node) {
      throw new Error("Pending node not found.");
    }

    if (node.status !== "pending") {
      throw new Error("Only pending nodes can be added to the canvas.");
    }

    let parentNode: typeof node | null = null;

    if (args.connectToNodeId) {
      parentNode = await ctx.db.get(args.connectToNodeId);

      if (!parentNode || parentNode.status !== "active") {
        throw new Error("Choose an existing canvas node to connect to.");
      }

      if (parentNode._id === node._id) {
        throw new Error("A node cannot connect to itself.");
      }
    }

    const offset = getActivationOffset(node._id);
    const x = parentNode
      ? parentNode.x + offset.x
      : Math.round(args.viewportCenterX - FALLBACK_NODE_WIDTH / 2);
    const y = parentNode
      ? parentNode.y + offset.y
      : Math.round(args.viewportCenterY - FALLBACK_NODE_HEIGHT / 2);

    const patch: {
      status: "active";
      x: number;
      y: number;
      sourceParentId?: Id<"nodes">;
    } = {
      status: "active",
      x,
      y,
    };

    if (parentNode && node.label === "source" && parentNode.label === "source") {
      patch.sourceParentId = parentNode._id;
    }

    await ctx.db.patch(node._id, patch);

    if (parentNode) {
      await ctx.db.insert("connections", {
        from: node._id,
        to: parentNode._id,
        createdAt: Date.now(),
      });
    }

    return {
      activatedNodeId: node._id,
      x,
      y,
    };
  },
});
