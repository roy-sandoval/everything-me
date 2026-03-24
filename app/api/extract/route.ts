import { openai } from "@ai-sdk/openai";
import { generateText, Output } from "ai";
import { NextResponse } from "next/server";

import {
  extractionRequestSchema,
  extractionResponseSchema,
  normalizeExtractionResponse,
} from "@/lib/extraction";

const OPENAI_MODEL = process.env.OPENAI_MODEL?.trim() || "gpt-5-mini";

const EXTRACTION_SYSTEM_PROMPT = `
You extract a thought web from pasted writing.

Return concise, scan-friendly nodes and semantic connections.

Rules:
- Produce 15 to 30 nodes when the source material supports it.
- Every node must have:
  - clientId: a short unique id like n1, n2, n3
  - text: a compact card label, usually 3 to 16 words, never empty
  - label: one of source, note, experience, learning, realization
- Prefer short phrases over full sentences.
- Remove duplicates and near-duplicates.
- Preserve titles or references for source nodes.
- Only add connections when the relationship is meaningfully strong.
- Connections should reference node ids using fromClientId and toClientId.
- Do not connect a node to itself.
- Do not include explanations outside the structured output.

Label guide:
- source: something the writer is reading, citing, or referencing
- note: the writer's thought or interpretation
- experience: something that happened to the writer
- learning: a fact or insight the writer learned
- realization: a connection the writer made between ideas
`.trim();

export async function POST(request: Request) {
  if (!process.env.OPENAI_API_KEY) {
    return NextResponse.json(
      { error: "Set OPENAI_API_KEY to enable extraction." },
      { status: 500 },
    );
  }

  let rawBody: unknown;

  try {
    rawBody = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Send JSON with a text field to extract from." },
      { status: 400 },
    );
  }

  const parsedRequest = extractionRequestSchema.safeParse(rawBody);

  if (!parsedRequest.success) {
    return NextResponse.json(
      { error: parsedRequest.error.issues[0]?.message ?? "Invalid request." },
      { status: 400 },
    );
  }

  try {
    const { output } = await generateText({
      model: openai(OPENAI_MODEL),
      system: EXTRACTION_SYSTEM_PROMPT,
      prompt: `Extract a thought web from the following text:\n\n${parsedRequest.data.text}`,
      temperature: 0.3,
      output: Output.object({
        schema: extractionResponseSchema,
      }),
    });

    const normalizedOutput = normalizeExtractionResponse(output);

    if (normalizedOutput.nodes.length === 0) {
      return NextResponse.json(
        { error: "The model could not find any usable nodes to import." },
        { status: 422 },
      );
    }

    return NextResponse.json(normalizedOutput);
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Could not extract nodes from that text.",
      },
      { status: 500 },
    );
  }
}
