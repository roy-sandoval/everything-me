import { v } from "convex/values";

import type { Doc, Id } from "./_generated/dataModel";
import { mutation, query } from "./_generated/server";

const MAX_NODES = 500;
const MAX_CONNECTIONS = 1_500;
const MAX_CONNECTIONS_PER_NODE = 500;

export const getCanvas = query({
  args: {},
  handler: async (ctx): Promise<{
    nodes: Doc<"nodes">[];
    connections: Doc<"connections">[];
  }> => {
    const nodes = await ctx.db.query("nodes").take(MAX_NODES);
    const connections = await ctx.db.query("connections").take(MAX_CONNECTIONS);

    return {
      nodes,
      connections,
    };
  },
});

export const createNode = mutation({
  args: {
    text: v.string(),
    x: v.number(),
    y: v.number(),
  },
  handler: async (ctx, args): Promise<Id<"nodes">> => {
    const text = args.text.trim();

    if (!text) {
      throw new Error("Text is required.");
    }

    return await ctx.db.insert("nodes", {
      text,
      x: args.x,
      y: args.y,
      createdAt: Date.now(),
    });
  },
});

export const moveNode = mutation({
  args: {
    nodeId: v.id("nodes"),
    x: v.number(),
    y: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const node = await ctx.db.get(args.nodeId);

    if (!node) {
      throw new Error("Node not found.");
    }

    await ctx.db.patch(args.nodeId, {
      x: args.x,
      y: args.y,
    });

    return null;
  },
});

export const updateNode = mutation({
  args: {
    nodeId: v.id("nodes"),
    text: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const node = await ctx.db.get(args.nodeId);

    if (!node) {
      throw new Error("Node not found.");
    }

    const text = args.text.trim();

    if (!text) {
      throw new Error("Text is required.");
    }

    await ctx.db.patch(args.nodeId, {
      text,
    });

    return null;
  },
});

export const createConnection = mutation({
  args: {
    from: v.id("nodes"),
    to: v.id("nodes"),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    if (args.from === args.to) {
      throw new Error("A node cannot connect to itself.");
    }

    const [fromNode, toNode] = await Promise.all([
      ctx.db.get(args.from),
      ctx.db.get(args.to),
    ]);

    if (!fromNode || !toNode) {
      throw new Error("Both nodes must exist before connecting them.");
    }

    const [forward, reverse] = await Promise.all([
      ctx.db
        .query("connections")
        .withIndex("by_from", (q) => q.eq("from", args.from))
        .take(MAX_CONNECTIONS_PER_NODE),
      ctx.db
        .query("connections")
        .withIndex("by_from", (q) => q.eq("from", args.to))
        .take(MAX_CONNECTIONS_PER_NODE),
    ]);

    const duplicateExists =
      forward.some((connection) => connection.to === args.to) ||
      reverse.some((connection) => connection.to === args.from);

    if (duplicateExists) {
      return null;
    }

    await ctx.db.insert("connections", {
      from: args.from,
      to: args.to,
      createdAt: Date.now(),
    });

    return null;
  },
});

export const deleteNode = mutation({
  args: {
    nodeId: v.id("nodes"),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const node = await ctx.db.get(args.nodeId);

    if (!node) {
      return null;
    }

    const [outgoing, incoming] = await Promise.all([
      ctx.db
        .query("connections")
        .withIndex("by_from", (q) => q.eq("from", args.nodeId))
        .take(MAX_CONNECTIONS_PER_NODE),
      ctx.db
        .query("connections")
        .withIndex("by_to", (q) => q.eq("to", args.nodeId))
        .take(MAX_CONNECTIONS_PER_NODE),
    ]);

    for (const connection of outgoing) {
      await ctx.db.delete(connection._id);
    }

    for (const connection of incoming) {
      await ctx.db.delete(connection._id);
    }

    await ctx.db.delete(args.nodeId);

    return null;
  },
});
