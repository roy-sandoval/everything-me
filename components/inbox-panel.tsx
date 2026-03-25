"use client";

import type { NodeLabel } from "@/lib/node-labels";
import { cn } from "@/lib/utils";

type PendingNodeItem = {
  _id: string;
  text: string;
  label?: NodeLabel;
  sourceTitle?: string;
  sourceUrl?: string;
};

type ActiveNodeOption = {
  _id: string;
  text: string;
  label?: NodeLabel;
};

const INBOX_LABEL_STYLES: Record<
  NodeLabel,
  {
    badgeLabel: string;
    badgeClassName: string;
    borderClassName: string;
  }
> = {
  source: {
    badgeLabel: "Source",
    badgeClassName: "bg-sky-300/15 text-sky-100",
    borderClassName: "border-sky-300/22",
  },
  note: {
    badgeLabel: "Note",
    badgeClassName: "bg-white/10 text-white/72",
    borderClassName: "border-white/10",
  },
  experience: {
    badgeLabel: "Experience",
    badgeClassName: "bg-rose-300/15 text-rose-100",
    borderClassName: "border-rose-300/22",
  },
  learning: {
    badgeLabel: "Learning",
    badgeClassName: "bg-emerald-300/15 text-emerald-100",
    borderClassName: "border-emerald-300/22",
  },
  realization: {
    badgeLabel: "Realization",
    badgeClassName: "bg-amber-300/18 text-amber-50",
    borderClassName: "border-amber-300/22",
  },
};

export function InboxPanel({
  pendingNodes,
  activeNodes,
  selectedConnectionIds,
  suggestedConnectionIds,
  suggestionLoadingNodeIds,
  busyActionByNodeId,
  onSelectConnection,
  onActivate,
  onDismiss,
}: {
  pendingNodes: PendingNodeItem[];
  activeNodes: ActiveNodeOption[];
  selectedConnectionIds: Record<string, string>;
  suggestedConnectionIds: Record<string, string | null>;
  suggestionLoadingNodeIds: Record<string, boolean>;
  busyActionByNodeId: Record<string, "activate" | "dismiss" | undefined>;
  onSelectConnection: (nodeId: string, nextValue: string) => void;
  onActivate: (nodeId: string) => void;
  onDismiss: (nodeId: string) => void;
}) {
  return (
    <div className="flex h-full flex-col rounded-[1.8rem] border border-white/10 bg-[rgb(10_14_24_/_0.92)] p-4 shadow-[0_24px_80px_rgba(0,0,0,0.36)] backdrop-blur-xl">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-[11px] font-medium uppercase tracking-[0.28em] text-cyan-100/70">
            Pending
          </p>
          <h2 className="mt-2 text-xl font-semibold text-white">
            Inbox
          </h2>
        </div>
        <span className="rounded-full bg-cyan-300 px-3 py-1 text-xs font-semibold uppercase tracking-[0.22em] text-slate-950">
          {pendingNodes.length}
        </span>
      </div>

      <p className="mt-3 text-sm leading-6 text-white/58">
        Captured highlights land here first. Pick a connection, confirm, and they
        slide onto the canvas.
      </p>

      <div className="mt-5 min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
        {pendingNodes.length > 0 ? (
          pendingNodes.map((node) => {
            const label = node.label ?? "note";
            const labelStyle = INBOX_LABEL_STYLES[label];
            const selectedConnectionId = selectedConnectionIds[node._id] ?? "none";
            const suggestionNodeId = suggestedConnectionIds[node._id] ?? null;
            const isSuggesting = suggestionLoadingNodeIds[node._id] ?? false;
            const activeAction = busyActionByNodeId[node._id];

            return (
              <article
                key={node._id}
                className={cn(
                  "rounded-[1.45rem] border bg-white/[0.04] p-4 text-white transition",
                  labelStyle.borderClassName,
                )}
              >
                <div className="flex items-center justify-between gap-3">
                  <span
                    className={cn(
                      "rounded-full px-2.5 py-1 text-[11px] font-medium uppercase tracking-[0.22em]",
                      labelStyle.badgeClassName,
                    )}
                  >
                    {labelStyle.badgeLabel}
                  </span>
                  {suggestionNodeId ? (
                    <span className="text-[10px] font-semibold uppercase tracking-[0.24em] text-cyan-100/75">
                      AI suggested
                    </span>
                  ) : isSuggesting ? (
                    <span className="text-[10px] font-semibold uppercase tracking-[0.24em] text-white/42">
                      Thinking
                    </span>
                  ) : null}
                </div>

                <p className="mt-3 text-sm leading-6 whitespace-pre-wrap text-white/90">
                  {truncate(node.text, 220)}
                </p>

                {node.sourceTitle || node.sourceUrl ? (
                  <p className="mt-3 text-xs leading-5 text-white/52">
                    from: {node.sourceTitle || formatUrl(node.sourceUrl)}
                  </p>
                ) : null}

                <label className="mt-4 block text-[11px] font-medium uppercase tracking-[0.24em] text-white/48">
                  Connect to
                </label>
                <select
                  value={selectedConnectionId}
                  onChange={(event) => onSelectConnection(node._id, event.target.value)}
                  disabled={activeAction !== undefined}
                  className="mt-2 h-10 w-full rounded-xl border border-white/10 bg-[rgb(18_24_38_/_0.95)] px-3 text-sm text-white outline-none transition focus:border-cyan-200/35 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <option value="none">No connection</option>
                  {activeNodes.map((activeNode) => (
                    <option key={activeNode._id} value={activeNode._id}>
                      {formatOptionLabel(activeNode)}
                    </option>
                  ))}
                </select>

                <div className="mt-4 flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => onActivate(node._id)}
                    disabled={activeAction !== undefined}
                    className="rounded-full bg-cyan-300 px-4 py-2 text-sm font-semibold text-slate-950 transition hover:scale-[1.01] hover:bg-cyan-200 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {activeAction === "activate" ? "Adding..." : "Add to Canvas"}
                  </button>
                  <button
                    type="button"
                    onClick={() => onDismiss(node._id)}
                    disabled={activeAction !== undefined}
                    className="rounded-full border border-white/10 px-4 py-2 text-sm font-medium text-white/72 transition hover:border-white/20 hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {activeAction === "dismiss" ? "Dismissing..." : "Dismiss"}
                  </button>
                </div>
              </article>
            );
          })
        ) : (
          <div className="rounded-[1.45rem] border border-dashed border-white/10 bg-white/[0.03] p-5">
            <p className="text-sm font-medium text-white/78">Nothing pending.</p>
            <p className="mt-2 text-sm leading-6 text-white/55">
              Use the browser extension to capture a highlight, and it will show up
              here for review.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function formatOptionLabel(node: ActiveNodeOption) {
  const label = node.label ? INBOX_LABEL_STYLES[node.label].badgeLabel : "Note";
  return `${label} - ${truncate(node.text, 72)}`;
}

function formatUrl(url?: string) {
  if (!url) {
    return "Captured page";
  }

  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function truncate(value: string, length: number) {
  return value.length > length ? `${value.slice(0, length - 1)}…` : value;
}
