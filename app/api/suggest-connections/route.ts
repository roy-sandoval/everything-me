import { openai } from "@ai-sdk/openai";
import { generateText, Output } from "ai";
import { NextResponse } from "next/server";
import { z } from "zod";

const OPENAI_MODEL = process.env.OPENAI_MODEL?.trim() || "gpt-5-mini";

const suggestionRequestSchema = z.object({
  pendingNode: z.object({
    text: z.string().trim().min(1).max(300),
    label: z
      .enum(["source", "note", "experience", "learning", "realization"])
      .optional(),
    sourceTitle: z.string().trim().max(200).optional(),
    sourceUrl: z.string().trim().max(500).optional(),
  }),
  activeNodes: z
    .array(
      z.object({
        id: z.string().min(1),
        text: z.string().trim().min(1).max(300),
        label: z
          .enum(["source", "note", "experience", "learning", "realization"])
          .optional(),
      }),
    )
    .max(200),
});

const suggestionResponseSchema = z.object({
  suggestedNodeId: z.string().nullable(),
});

const CONNECTION_SUGGESTION_PROMPT = `
You suggest one existing node for a newly captured thought.

Rules:
- Return only one existing node id or null.
- Choose null when the match is weak, speculative, or ambiguous.
- Prefer semantic meaning over shared vocabulary.
- Use the pending node text as the primary signal.
- Source title and label are supporting hints, not requirements.
- Never invent an id.
`.trim();

export async function POST(request: Request) {
  let rawBody: unknown;

  try {
    rawBody = await request.json();
  } catch {
    return NextResponse.json(
      { suggestedNodeId: null, error: "Send JSON for connection suggestions." },
      { status: 400 },
    );
  }

  const parsedRequest = suggestionRequestSchema.safeParse(rawBody);

  if (!parsedRequest.success) {
    return NextResponse.json(
      {
        suggestedNodeId: null,
        error: parsedRequest.error.issues[0]?.message ?? "Invalid request.",
      },
      { status: 400 },
    );
  }

  if (!process.env.OPENAI_API_KEY || parsedRequest.data.activeNodes.length === 0) {
    return NextResponse.json({ suggestedNodeId: null });
  }

  try {
    const { output } = await generateText({
      model: openai(OPENAI_MODEL),
      system: CONNECTION_SUGGESTION_PROMPT,
      prompt: JSON.stringify(parsedRequest.data),
      output: Output.object({
        schema: suggestionResponseSchema,
      }),
    });

    const validNodeIds = new Set(
      parsedRequest.data.activeNodes.map((node) => node.id),
    );
    const suggestedNodeId =
      output.suggestedNodeId && validNodeIds.has(output.suggestedNodeId)
        ? output.suggestedNodeId
        : null;

    return NextResponse.json({ suggestedNodeId });
  } catch {
    return NextResponse.json({ suggestedNodeId: null });
  }
}
