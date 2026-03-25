import { httpRouter } from "convex/server";

import { api } from "./_generated/api";
import { httpAction } from "./_generated/server";

const http = httpRouter();

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

http.route({
  path: "/api/addNode",
  method: "OPTIONS",
  handler: httpAction(async () => {
    return new Response(null, {
      status: 204,
      headers: corsHeaders,
    });
  }),
});

http.route({
  path: "/api/addNode",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    let body: unknown;

    try {
      body = await request.json();
    } catch {
      return new Response(JSON.stringify({ error: "Invalid JSON body." }), {
        status: 400,
        headers: {
          "Content-Type": "application/json",
          ...corsHeaders,
        },
      });
    }

    if (!body || typeof body !== "object") {
      return new Response(JSON.stringify({ error: "Invalid request body." }), {
        status: 400,
        headers: {
          "Content-Type": "application/json",
          ...corsHeaders,
        },
      });
    }

    const payload = body as {
      text?: unknown;
      label?: unknown;
      sourceUrl?: unknown;
      sourceTitle?: unknown;
      createdAt?: unknown;
    };

    if (
      typeof payload.text !== "string" ||
      typeof payload.label !== "string" ||
      typeof payload.createdAt !== "number"
    ) {
      return new Response(
        JSON.stringify({ error: "Expected text, label, and createdAt." }),
        {
          status: 400,
          headers: {
            "Content-Type": "application/json",
            ...corsHeaders,
          },
        },
      );
    }

    try {
      const nodeId = await ctx.runMutation(api.inbox.createPendingNode, {
        text: payload.text,
        label: payload.label as
          | "source"
          | "note"
          | "experience"
          | "learning"
          | "realization",
        sourceUrl: typeof payload.sourceUrl === "string" ? payload.sourceUrl : undefined,
        sourceTitle:
          typeof payload.sourceTitle === "string" ? payload.sourceTitle : undefined,
        createdAt: payload.createdAt,
      });

      return new Response(JSON.stringify({ ok: true, nodeId }), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          ...corsHeaders,
        },
      });
    } catch (error) {
      return new Response(
        JSON.stringify({
          error: error instanceof Error ? error.message : "Could not add node.",
        }),
        {
          status: 400,
          headers: {
            "Content-Type": "application/json",
            ...corsHeaders,
          },
        },
      );
    }
  }),
});

export default http;
