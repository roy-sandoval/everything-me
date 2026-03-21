"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useMutation, useQuery } from "convex/react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { api } from "@/convex/_generated/api";
import type { Doc } from "@/convex/_generated/dataModel";

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;

export function EntryCapture() {
  if (!convexUrl) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background px-6">
        <div className="w-full max-w-2xl rounded-3xl border border-border bg-background p-8 shadow-sm">
          <p className="text-sm font-medium uppercase tracking-[0.2em] text-muted-foreground">
            Convex is installed
          </p>
          <h1 className="mt-4 text-3xl font-semibold text-foreground">
            Connect a deployment to start saving entries.
          </h1>
          <p className="mt-3 text-base text-muted-foreground">
            Run <code className="rounded bg-muted px-1.5 py-0.5">pnpm exec convex dev</code>{" "}
            and let Convex populate{" "}
            <code className="rounded bg-muted px-1.5 py-0.5">
              NEXT_PUBLIC_CONVEX_URL
            </code>
            .
          </p>
        </div>
      </main>
    );
  }

  return <ConnectedEntryCapture />;
}

function ConnectedEntryCapture() {
  const entries = useQuery(api.entries.list);
  const createEntry = useMutation(api.entries.create);
  const deleteEntry = useMutation(api.entries.remove);
  const requestBackfill = useMutation(api.entries.requestBackfill);
  const [content, setContent] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [entryPendingDelete, setEntryPendingDelete] = useState<Entry | null>(null);
  const [deletingEntryId, setDeletingEntryId] = useState<Entry["_id"] | null>(null);
  const hasRequestedBackfill = useRef(false);

  useEffect(() => {
    if (!entries || hasRequestedBackfill.current) {
      return;
    }

    hasRequestedBackfill.current = true;
    void requestBackfill({}).catch(() => {
      hasRequestedBackfill.current = false;
    });
  }, [entries, requestBackfill]);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const nextContent = content.trim();
    if (!nextContent) {
      setError("Add a thought or link first.");
      return;
    }

    setIsSaving(true);
    setError(null);

    try {
      await createEntry({ content: nextContent });
      setContent("");
    } catch (submissionError) {
      setError(
        submissionError instanceof Error
          ? submissionError.message
          : "Something went wrong while saving your entry.",
      );
    } finally {
      setIsSaving(false);
    }
  }

  function handleDeleteRequest(entry: Entry) {
    setError(null);
    setEntryPendingDelete(entry);
  }

  async function handleDeleteConfirm() {
    if (!entryPendingDelete) {
      return;
    }

    const entryId = entryPendingDelete._id;
    setDeletingEntryId(entryId);
    setError(null);

    try {
      await deleteEntry({ entryId });
      setEntryPendingDelete((currentEntry) =>
        currentEntry?._id === entryId ? null : currentEntry,
      );
    } catch (deletionError) {
      setError(
        deletionError instanceof Error
          ? deletionError.message
          : "Something went wrong while deleting your entry.",
      );
    } finally {
      setDeletingEntryId((currentId) => (currentId === entryId ? null : currentId));
    }
  }

  const isDeleteDialogOpen = entryPendingDelete !== null;
  const isDialogDeleting = entryPendingDelete?._id === deletingEntryId;

  return (
    <>
      <main className="min-h-screen bg-background px-6 py-16">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-10">
          <section className="rounded-[2rem] border border-border bg-background p-8 shadow-sm">
            <p className="text-sm font-medium uppercase tracking-[0.2em] text-muted-foreground">
              Everything Me
            </p>
            <h1 className="mt-4 text-4xl font-semibold tracking-tight text-foreground">
              Capture the links and thoughts you want to keep.
            </h1>
            <p className="mt-3 max-w-2xl text-base leading-7 text-muted-foreground">
              Paste a URL or write a note. Convex will store it live and label it
              as a link or a thought automatically.
            </p>

            <form className="mt-8 flex flex-col gap-4" onSubmit={handleSubmit}>
              <Input
                aria-label="Type or paste anything"
                placeholder="type or paste anything"
                className="h-14 rounded-2xl border-border bg-background text-base shadow-none"
                disabled={isSaving}
                value={content}
                onChange={(event) => setContent(event.target.value)}
              />
              <div className="flex items-center justify-between gap-4">
                <p className="text-sm text-muted-foreground">
                  {error ?? "Your newest 20 entries will appear below."}
                </p>
                <button
                  type="submit"
                  className="rounded-full bg-foreground px-5 py-2.5 text-sm font-medium text-background transition-opacity disabled:cursor-not-allowed disabled:opacity-60"
                  disabled={isSaving}
                >
                  {isSaving ? "Saving..." : "Save entry"}
                </button>
              </div>
            </form>
          </section>

          <section className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-foreground">
                Recent entries
              </h2>
              <p className="text-sm text-muted-foreground">
                {entries ? `${entries.length} saved` : "Loading..."}
              </p>
            </div>

            <div className="space-y-3">
              {entries?.length ? (
                entries.map((entry) => (
                  <EntryCard
                    key={entry._id}
                    entry={entry}
                    isDeleting={deletingEntryId === entry._id}
                    onDeleteRequest={handleDeleteRequest}
                  />
                ))
              ) : (
                <div className="rounded-3xl border border-dashed border-border bg-card/40 p-8 text-center text-muted-foreground">
                  {entries
                    ? "No entries yet. Save your first one above."
                    : "Loading entries..."}
                </div>
              )}
            </div>
          </section>
        </div>
      </main>

      <AlertDialog
        open={isDeleteDialogOpen}
        onOpenChange={(nextOpen) => {
          if (nextOpen || deletingEntryId) {
            return;
          }

          setEntryPendingDelete(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete entry?</AlertDialogTitle>
            <AlertDialogDescription>
              This action cannot be undone. The selected entry will be removed
              from your list immediately.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDialogDeleting}>
              Keep entry
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={isDialogDeleting}
              onClick={(event) => {
                event.preventDefault();
                void handleDeleteConfirm();
              }}
            >
              {isDialogDeleting ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

type Entry = Doc<"entries">;

function EntryCard({
  entry,
  isDeleting,
  onDeleteRequest,
}: {
  entry: Entry;
  isDeleting: boolean;
  onDeleteRequest: (entry: Entry) => void;
}) {
  if (entry.type === "link" && entry.metadata?.url) {
    return (
      <LinkPreviewCard
        entry={entry}
        isDeleting={isDeleting}
        onDeleteRequest={onDeleteRequest}
      />
    );
  }

  return (
    <article className="rounded-3xl border border-border bg-card p-5 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <EntryMeta entry={entry} />
        <EntryActions
          entry={entry}
          isDeleting={isDeleting}
          onDeleteRequest={onDeleteRequest}
        />
      </div>
      <p className="mt-4 break-words text-base leading-7 text-card-foreground">
        {entry.content}
      </p>
    </article>
  );
}

function LinkPreviewCard({
  entry,
  isDeleting,
  onDeleteRequest,
}: {
  entry: Entry;
  isDeleting: boolean;
  onDeleteRequest: (entry: Entry) => void;
}) {
  const metadata = entry.metadata ?? {};
  const isYouTube = isYouTubeUrl(metadata.url);
  const hostname = getHostname(metadata.url);
  const title = metadata.title ?? hostname ?? entry.content;
  const description =
    metadata.description ??
    (metadata.scrapeStatus === "pending"
      ? "Fetching a preview for this link."
      : metadata.scrapeStatus === "failed"
        ? "Preview unavailable, but the link is ready to open."
        : entry.content);

  return (
    <article className="overflow-hidden rounded-3xl border border-border bg-card shadow-sm transition-transform duration-200 hover:-translate-y-0.5">
      <div className="flex items-start justify-between gap-4 px-5 pt-5">
        <EntryMeta
          entry={entry}
          label="link"
          badge={isYouTube ? <YouTubeBadge /> : undefined}
        />
        <EntryActions
          entry={entry}
          isDeleting={isDeleting}
          onDeleteRequest={onDeleteRequest}
        />
      </div>
      <a
        href={metadata.url}
        target="_blank"
        rel="noreferrer"
        className="block focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      >
        {metadata.image ? (
          <div className="relative mt-4 h-48 w-full overflow-hidden bg-muted">
            {/* eslint-disable-next-line @next/next/no-img-element -- Open Graph images come from arbitrary hosts. */}
            <img
              src={metadata.image}
              alt=""
              className="h-full w-full object-cover"
              loading="lazy"
              referrerPolicy="no-referrer"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-black/30 via-black/5 to-transparent" />
          </div>
        ) : (
          <div className="mt-4 flex h-32 items-end bg-[linear-gradient(135deg,rgba(15,23,42,0.08),rgba(15,23,42,0.02),rgba(15,23,42,0.12))] p-5">
            <span className="rounded-full bg-background/90 px-3 py-1 text-xs font-medium uppercase tracking-[0.18em] text-foreground shadow-sm">
              {hostname ?? "link"}
            </span>
          </div>
        )}

        <div className="p-5">
          <h3 className="mt-4 text-xl font-semibold tracking-tight text-card-foreground">
            {title}
          </h3>
          <p className="mt-2 line-clamp-3 break-words text-sm leading-6 text-muted-foreground">
            {description}
          </p>

          <div className="mt-5 flex items-center justify-between gap-4 text-sm">
            {!isYouTube ? (
              <span className="truncate font-medium text-card-foreground">
                {hostname ?? metadata.url}
              </span>
            ) : (
              <span aria-hidden="true" />
            )}
            <span className="shrink-0 text-muted-foreground">
              {getLinkStatusLabel(metadata.scrapeStatus)}
            </span>
          </div>

          {metadata.url && !isYouTube ? (
            <p className="mt-2 truncate text-xs text-muted-foreground">
              {metadata.url}
            </p>
          ) : null}
        </div>
      </a>
    </article>
  );
}

function EntryMeta({
  entry,
  label = entry.type,
  badge,
}: {
  entry: Entry;
  label?: string;
  badge?: ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-3">
      {badge ?? (
        <span className="rounded-full bg-secondary px-3 py-1 text-xs font-medium uppercase tracking-[0.18em] text-secondary-foreground">
          {label}
        </span>
      )}
      <time className="text-sm text-muted-foreground">
        {new Date(entry._creationTime).toLocaleString()}
      </time>
    </div>
  );
}

function EntryActions({
  entry,
  isDeleting,
  onDeleteRequest,
}: {
  entry: Entry;
  isDeleting: boolean;
  onDeleteRequest: (entry: Entry) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="rounded-full border border-border px-3 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
          disabled={isDeleting}
          aria-label={`Open actions for this ${entry.type} entry`}
        >
          Actions
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem
          variant="destructive"
          disabled={isDeleting}
          onSelect={(event) => {
            event.preventDefault();
            onDeleteRequest(entry);
          }}
        >
          {isDeleting ? "Deleting..." : "Delete"}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function getHostname(url: string | undefined) {
  if (!url) {
    return null;
  }

  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

function isYouTubeUrl(url: string | undefined) {
  if (!url) {
    return false;
  }

  try {
    const hostname = new URL(url).hostname.replace(/^www\./, "").toLowerCase();
    return hostname === "youtube.com" || hostname === "m.youtube.com" || hostname === "youtu.be";
  } catch {
    return false;
  }
}

function YouTubeBadge() {
  return (
    <span className="inline-flex items-center gap-2 rounded-full bg-[#ff0033] px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] text-white shadow-sm">
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        className="h-3.5 w-3.5 shrink-0"
        fill="currentColor"
      >
        <path d="M23.5 7.3a3 3 0 0 0-2.1-2.1C19.5 4.7 12 4.7 12 4.7s-7.5 0-9.4.5A3 3 0 0 0 .5 7.3 31.4 31.4 0 0 0 0 12a31.4 31.4 0 0 0 .5 4.7 3 3 0 0 0 2.1 2.1c1.9.5 9.4.5 9.4.5s7.5 0 9.4-.5a3 3 0 0 0 2.1-2.1A31.4 31.4 0 0 0 24 12a31.4 31.4 0 0 0-.5-4.7ZM9.6 15.4V8.6l5.8 3.4-5.8 3.4Z" />
      </svg>
      YouTube Video
    </span>
  );
}

function getLinkStatusLabel(
  status: "pending" | "success" | "failed" | undefined,
) {
  switch (status) {
    case "pending":
      return "Fetching preview";
    case "failed":
      return "Preview unavailable";
    default:
      return "Open link";
  }
}
