import { v } from "convex/values";

import { internal } from "./_generated/api";
import {
  internalMutation,
  mutation,
  query,
  type MutationCtx,
} from "./_generated/server";

const BACKFILL_PAGE_SIZE = 12;

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

    const entryId = await ctx.db.insert("entries", {
      content,
      type,
      metadata:
        type === "link"
          ? {
              url: content,
              scrapeStatus: "pending",
            }
          : undefined,
    });

    if (type === "link") {
      await ctx.scheduler.runAfter(0, internal.linkPreviews.scrapeEntry, {
        entryId,
        url: content,
      });
    }

    return entryId;
  },
});

export const requestBackfill = mutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    await enqueueBackfillBatch(ctx, null);
    return null;
  },
});

export const remove = mutation({
  args: {
    entryId: v.id("entries"),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const entry = await ctx.db.get(args.entryId);

    if (!entry) {
      return null;
    }

    await ctx.db.delete(args.entryId);
    return null;
  },
});

export const enqueueLinkPreviewBackfill = internalMutation({
  args: {
    cursor: v.union(v.string(), v.null()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await enqueueBackfillBatch(ctx, args.cursor);
    return null;
  },
});

export const saveLinkPreview = internalMutation({
  args: {
    entryId: v.id("entries"),
    metadata: v.object({
      url: v.string(),
      scrapeStatus: v.union(
        v.literal("pending"),
        v.literal("success"),
        v.literal("failed"),
      ),
      scrapedAt: v.number(),
      title: v.optional(v.string()),
      description: v.optional(v.string()),
      image: v.optional(v.string()),
    }),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const entry = await ctx.db.get(args.entryId);

    if (!entry || entry.type !== "link") {
      return null;
    }

    const existingMetadata = entry.metadata ?? {};

    if (
      existingMetadata.scrapeStatus === "success" &&
      args.metadata.scrapeStatus === "failed"
    ) {
      return null;
    }

    await ctx.db.patch(args.entryId, {
      metadata: {
        ...existingMetadata,
        ...args.metadata,
      },
    });

    return null;
  },
});

async function enqueueBackfillBatch(ctx: MutationCtx, cursor: string | null) {
  const page = await ctx.db
    .query("entries")
    .withIndex("by_type", (query) => query.eq("type", "link"))
    .order("desc")
    .paginate({
      cursor,
      numItems: BACKFILL_PAGE_SIZE,
    });

  for (const entry of page.page) {
    if (!needsBackfill(entry)) {
      continue;
    }

    const url = entry.metadata?.url ?? entry.content;

    await ctx.db.patch(entry._id, {
      metadata: {
        ...entry.metadata,
        url,
        scrapeStatus: "pending",
      },
    });

    await ctx.scheduler.runAfter(0, internal.linkPreviews.scrapeEntry, {
      entryId: entry._id,
      url,
    });
  }

  if (!page.isDone) {
    await ctx.scheduler.runAfter(0, internal.entries.enqueueLinkPreviewBackfill, {
      cursor: page.continueCursor,
    });
  }
}

function needsBackfill(entry: {
  content: string;
  metadata?: {
    url?: string;
    title?: string;
    description?: string;
    image?: string;
    scrapeStatus?: "pending" | "success" | "failed";
  };
}) {
  if (!entry.metadata?.url && !/^https?:\/\//i.test(entry.content)) {
    return false;
  }

  if (entry.metadata?.scrapeStatus === "pending") {
    return false;
  }

  const hasPreview =
    !!entry.metadata?.title ||
    !!entry.metadata?.description ||
    !!entry.metadata?.image;

  if (hasPreview) {
    return false;
  }

  return true;
}
