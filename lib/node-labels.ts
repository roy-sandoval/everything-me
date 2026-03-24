export const NODE_LABELS = [
  "source",
  "note",
  "experience",
  "learning",
  "realization",
] as const;

export type NodeLabel = (typeof NODE_LABELS)[number];

export function isNodeLabel(value: string): value is NodeLabel {
  return NODE_LABELS.includes(value as NodeLabel);
}
