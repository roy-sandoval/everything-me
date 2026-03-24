import { v } from "convex/values";

import { api } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { mutation, query } from "./_generated/server";

const MAX_NODES = 500;
const MAX_CONNECTIONS = 1_500;
const MAX_CONNECTIONS_PER_NODE = 500;
const MAX_IMPORT_NODES = 30;
const MAX_IMPORT_CONNECTIONS = 90;
const CLEAR_BATCH_SIZE = 128;
const nodeLabelValidator = v.union(
  v.literal("source"),
  v.literal("note"),
  v.literal("experience"),
  v.literal("learning"),
  v.literal("realization"),
);

function getMoveGroupNodeIds(
  nodes: Doc<"nodes">[],
  connections: Doc<"connections">[],
  rootNodeId: Id<"nodes">,
): Id<"nodes">[] {
  const rootNode = nodes.find((node) => node._id === rootNodeId);

  if (!rootNode || rootNode.label !== "source") {
    return [];
  }

  const nodeById = new Map(nodes.map((node) => [node._id, node] as const));
  const sourceNodeIds = new Set<Id<"nodes">>();
  const childIdsByParentId = new Map<Id<"nodes">, Id<"nodes">[]>();
  const adjacencyByNodeId = new Map<Id<"nodes">, Set<Id<"nodes">>>();

  for (const node of nodes) {
    adjacencyByNodeId.set(node._id, new Set());

    if (node.label !== "source") {
      continue;
    }

    sourceNodeIds.add(node._id);

    if (!node.sourceParentId || node.sourceParentId === node._id) {
      continue;
    }

    const childIds = childIdsByParentId.get(node.sourceParentId) ?? [];
    childIds.push(node._id);
    childIdsByParentId.set(node.sourceParentId, childIds);
  }

  for (const connection of connections) {
    adjacencyByNodeId.get(connection.from)?.add(connection.to);
    adjacencyByNodeId.get(connection.to)?.add(connection.from);
  }

  const subtreeNodeIds: Id<"nodes">[] = [];
  const stack: Id<"nodes">[] = [rootNodeId];
  const visited = new Set<Id<"nodes">>();

  while (stack.length > 0) {
    const nodeId = stack.pop();

    if (!nodeId || visited.has(nodeId) || !sourceNodeIds.has(nodeId)) {
      continue;
    }

    visited.add(nodeId);
    subtreeNodeIds.push(nodeId);

    const childIds = childIdsByParentId.get(nodeId) ?? [];

    for (let index = childIds.length - 1; index >= 0; index -= 1) {
      stack.push(childIds[index]);
    }
  }

  const moveGroupNodeIds = [...subtreeNodeIds];
  const moveGroupNodeIdSet = new Set(moveGroupNodeIds);
  const queue = [...subtreeNodeIds];

  const enqueueSourceBranch = (sourceNodeId: Id<"nodes">) => {
    const sourceQueue: Id<"nodes">[] = [sourceNodeId];

    while (sourceQueue.length > 0) {
      const currentSourceNodeId = sourceQueue.pop();

      if (
        !currentSourceNodeId ||
        moveGroupNodeIdSet.has(currentSourceNodeId) ||
        !sourceNodeIds.has(currentSourceNodeId)
      ) {
        continue;
      }

      moveGroupNodeIdSet.add(currentSourceNodeId);
      moveGroupNodeIds.push(currentSourceNodeId);
      queue.push(currentSourceNodeId);

      const childIds = childIdsByParentId.get(currentSourceNodeId) ?? [];

      for (let index = childIds.length - 1; index >= 0; index -= 1) {
        sourceQueue.push(childIds[index]);
      }
    }
  };

  while (queue.length > 0) {
    const nodeId = queue.shift();

    if (!nodeId) {
      continue;
    }

    for (const neighborId of adjacencyByNodeId.get(nodeId) ?? []) {
      if (moveGroupNodeIdSet.has(neighborId)) {
        continue;
      }

      const neighbor = nodeById.get(neighborId);

      if (!neighbor) {
        continue;
      }

      if (neighbor.label === "source") {
        enqueueSourceBranch(neighborId);
        continue;
      }

      moveGroupNodeIdSet.add(neighborId);
      moveGroupNodeIds.push(neighborId);
      queue.push(neighborId);
    }
  }

  return moveGroupNodeIds;
}

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
    label: v.optional(nodeLabelValidator),
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
      label: args.label ?? "note",
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

    const delta = {
      x: args.x - node.x,
      y: args.y - node.y,
    };

    if (node.label !== "source") {
      await ctx.db.patch(args.nodeId, {
        x: args.x,
        y: args.y,
      });

      return null;
    }

    const [nodes, connections] = await Promise.all([
      ctx.db.query("nodes").take(MAX_NODES),
      ctx.db.query("connections").take(MAX_CONNECTIONS),
    ]);
    const nodeById = new Map(nodes.map((currentNode) => [currentNode._id, currentNode]));
    const subtreeNodeIds = getMoveGroupNodeIds(nodes, connections, args.nodeId);

    if (subtreeNodeIds.length === 0) {
      await ctx.db.patch(args.nodeId, {
        x: args.x,
        y: args.y,
      });

      return null;
    }

    for (const nodeId of subtreeNodeIds) {
      const currentNode = nodeById.get(nodeId);

      if (!currentNode) {
        continue;
      }

      await ctx.db.patch(nodeId, {
        x: currentNode.x + delta.x,
        y: currentNode.y + delta.y,
      });
    }

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

export const importExtraction = mutation({
  args: {
    nodes: v.array(
      v.object({
        clientId: v.string(),
        text: v.string(),
        label: nodeLabelValidator,
        parentSourceClientId: v.union(v.string(), v.null()),
        x: v.number(),
        y: v.number(),
      }),
    ),
    connections: v.array(
      v.object({
        fromClientId: v.string(),
        toClientId: v.string(),
      }),
    ),
  },
  returns: v.object({
    nodeCount: v.number(),
    connectionCount: v.number(),
  }),
  handler: async (ctx, args) => {
    const insertedNodes = new Map<string, Id<"nodes">>();
    const insertedNodeLabels = new Map<string, Doc<"nodes">["label"]>();
    const pendingSourceParents = new Map<string, string>();
    const dedupedTexts = new Set<string>();
    let nodeCount = 0;

    for (const node of args.nodes) {
      if (nodeCount >= MAX_IMPORT_NODES) {
        break;
      }

      const text = node.text.trim();
      const dedupeKey = text.toLocaleLowerCase();

      if (!text || !node.clientId || dedupedTexts.has(dedupeKey)) {
        continue;
      }

      const nodeId = await ctx.db.insert("nodes", {
        text,
        label: node.label,
        x: node.x,
        y: node.y,
        createdAt: Date.now(),
      });

      dedupedTexts.add(dedupeKey);
      insertedNodes.set(node.clientId, nodeId);
      insertedNodeLabels.set(node.clientId, node.label);

      if (node.label === "source" && node.parentSourceClientId) {
        pendingSourceParents.set(node.clientId, node.parentSourceClientId);
      }

      nodeCount += 1;
    }

    for (const [clientId, parentClientId] of pendingSourceParents) {
      const nodeId = insertedNodes.get(clientId);
      const parentNodeId = insertedNodes.get(parentClientId);

      if (
        !nodeId ||
        !parentNodeId ||
        nodeId === parentNodeId ||
        insertedNodeLabels.get(clientId) !== "source" ||
        insertedNodeLabels.get(parentClientId) !== "source"
      ) {
        continue;
      }

      await ctx.db.patch(nodeId, {
        sourceParentId: parentNodeId,
      });
    }

    const seenConnections = new Set<string>();
    let connectionCount = 0;

    for (const connection of args.connections) {
      if (connectionCount >= MAX_IMPORT_CONNECTIONS) {
        break;
      }

      const fromNodeId = insertedNodes.get(connection.fromClientId);
      const toNodeId = insertedNodes.get(connection.toClientId);

      if (!fromNodeId || !toNodeId || fromNodeId === toNodeId) {
        continue;
      }

      const connectionKey = [fromNodeId, toNodeId].sort().join(":");

      if (seenConnections.has(connectionKey)) {
        continue;
      }

      seenConnections.add(connectionKey);

      await ctx.db.insert("connections", {
        from: fromNodeId,
        to: toNodeId,
        createdAt: Date.now(),
      });

      connectionCount += 1;
    }

    return {
      nodeCount,
      connectionCount,
    };
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

export const clearCanvas = mutation({
  args: {},
  returns: v.object({
    completed: v.boolean(),
  }),
  handler: async (ctx) => {
    const connections = await ctx.db.query("connections").take(CLEAR_BATCH_SIZE);

    if (connections.length > 0) {
      for (const connection of connections) {
        await ctx.db.delete(connection._id);
      }

      if (connections.length === CLEAR_BATCH_SIZE) {
        await ctx.scheduler.runAfter(0, api.graph.clearCanvas, {});
      }

      return {
        completed: false,
      };
    }

    const nodes = await ctx.db.query("nodes").take(CLEAR_BATCH_SIZE);

    if (nodes.length > 0) {
      for (const node of nodes) {
        await ctx.db.delete(node._id);
      }

      if (nodes.length === CLEAR_BATCH_SIZE) {
        await ctx.scheduler.runAfter(0, api.graph.clearCanvas, {});
      }

      return {
        completed: false,
      };
    }

    return {
      completed: true,
    };
  },
});
