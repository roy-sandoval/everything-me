import { z } from "zod";

import { NODE_LABELS } from "./node-labels";

export const MAX_EXTRACTION_INPUT_CHARS = 40_000;
export const MAX_EXTRACTED_NODES = 30;
export const MAX_EXTRACTED_CONNECTIONS = 90;

export const extractionRequestSchema = z.object({
  text: z.string().trim().min(1, "Paste some text to extract from.").max(
    MAX_EXTRACTION_INPUT_CHARS,
    `Paste ${MAX_EXTRACTION_INPUT_CHARS.toLocaleString()} characters or fewer.`,
  ),
});

export const extractedNodeSchema = z.object({
  clientId: z.string().min(1),
  text: z.string().trim().min(1).max(160),
  label: z.enum(NODE_LABELS),
  parentSourceClientId: z.string().trim().min(1).optional(),
});

export const extractedConnectionSchema = z.object({
  fromClientId: z.string().min(1),
  toClientId: z.string().min(1),
});

export const extractionResponseSchema = z.object({
  nodes: z.array(extractedNodeSchema),
  connections: z.array(extractedConnectionSchema),
});

export type ExtractionRequest = z.infer<typeof extractionRequestSchema>;
export type ExtractedNode = z.infer<typeof extractedNodeSchema>;
export type ExtractedConnection = z.infer<typeof extractedConnectionSchema>;
export type ExtractionResponse = z.infer<typeof extractionResponseSchema>;

export function normalizeExtractionResponse(
  payload: ExtractionResponse,
): ExtractionResponse {
  const dedupedNodes: ExtractedNode[] = [];
  const textToClientId = new Map<string, string>();
  const originalIdToCanonicalId = new Map<string, string>();

  for (const node of payload.nodes) {
    const trimmedText = node.text.trim().replace(/\s+/g, " ");

    if (!trimmedText) {
      continue;
    }

    const canonicalText = trimmedText.toLocaleLowerCase();
    const existingClientId = textToClientId.get(canonicalText);

    if (existingClientId) {
      originalIdToCanonicalId.set(node.clientId, existingClientId);
      continue;
    }

    if (dedupedNodes.length >= MAX_EXTRACTED_NODES) {
      continue;
    }

    const clientId = `node-${dedupedNodes.length + 1}`;

    dedupedNodes.push({
      clientId,
      text: trimmedText,
      label: node.label,
      parentSourceClientId:
        node.label === "source" ? node.parentSourceClientId?.trim() : undefined,
    });
    textToClientId.set(canonicalText, clientId);
    originalIdToCanonicalId.set(node.clientId, clientId);
  }

  const nodeByClientId = new Map(
    dedupedNodes.map((node) => [node.clientId, node] as const),
  );

  for (const node of dedupedNodes) {
    if (node.label !== "source") {
      delete node.parentSourceClientId;
      continue;
    }

    const canonicalParentId = node.parentSourceClientId
      ? originalIdToCanonicalId.get(node.parentSourceClientId)
      : undefined;
    const parentNode = canonicalParentId
      ? nodeByClientId.get(canonicalParentId)
      : undefined;

    if (
      !canonicalParentId ||
      canonicalParentId === node.clientId ||
      !parentNode ||
      parentNode.label !== "source"
    ) {
      delete node.parentSourceClientId;
      continue;
    }

    node.parentSourceClientId = canonicalParentId;
  }

  const dedupedConnections: ExtractedConnection[] = [];
  const seenConnections = new Set<string>();

  for (const connection of payload.connections) {
    const fromClientId = originalIdToCanonicalId.get(connection.fromClientId);
    const toClientId = originalIdToCanonicalId.get(connection.toClientId);

    if (!fromClientId || !toClientId || fromClientId === toClientId) {
      continue;
    }

    const connectionKey = [fromClientId, toClientId].sort().join(":");

    if (seenConnections.has(connectionKey)) {
      continue;
    }

    seenConnections.add(connectionKey);
    dedupedConnections.push({
      fromClientId,
      toClientId,
    });

    if (dedupedConnections.length >= MAX_EXTRACTED_CONNECTIONS) {
      break;
    }
  }

  return {
    nodes: dedupedNodes,
    connections: dedupedConnections,
  };
}
