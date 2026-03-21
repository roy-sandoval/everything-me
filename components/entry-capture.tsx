"use client";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";

import { Input } from "@/components/ui/input";
import { api } from "@/convex/_generated/api";

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
  const [content, setContent] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

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

  return (
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
                <article
                  key={entry._id}
                  className="rounded-3xl border border-border bg-card p-5 shadow-sm"
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="rounded-full bg-secondary px-3 py-1 text-xs font-medium uppercase tracking-[0.18em] text-secondary-foreground">
                      {entry.type}
                    </span>
                    <time className="text-sm text-muted-foreground">
                      {new Date(entry._creationTime).toLocaleString()}
                    </time>
                  </div>
                  <p className="mt-4 break-words text-base leading-7 text-card-foreground">
                    {entry.content}
                  </p>
                  {entry.metadata?.url ? (
                    <a
                      href={entry.metadata.url}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-4 inline-flex text-sm font-medium text-foreground underline underline-offset-4"
                    >
                      Open link
                    </a>
                  ) : null}
                </article>
              ))
            ) : (
              <div className="rounded-3xl border border-dashed border-border bg-card/40 p-8 text-center text-muted-foreground">
                {entries ? "No entries yet. Save your first one above." : "Loading entries..."}
              </div>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}
