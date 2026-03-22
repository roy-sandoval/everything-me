---
created on: Sunday, March 22, 2026
note: This is me thinking about building it for iPad instead and prioritizing having fun. Also I want to have fun with the design and animations.
---

# The Space — Roadmap

## The Three Phases

```
Phase 1: Input App (Next.js + Convex)          ← you are here
Document your days. Extract artifacts. Show collections + connections.

Phase 2: Learning Layer
Tap any artifact → go deeper → research → save what you learn.

Phase 3: iPad Canvas (Swift)
Spatial canvas. Gestures. Apple Pencil. Explore connections, remixes, ideas.
```

Each phase feeds the next. You can't explore a canvas with no content. You can't go deeper with nothing to go deeper on. Start with the dump.

---

## Phase 1: The Input App

### Step 1 — The Core Input

The input is documenting your days. What you learned, found, realized, liked.

You open The Space, you dump what happened or what's on your mind. Free text, links, whatever. This is the raw material.

### Step 2 — Extract Artifacts

From your raw input, the app identifies and extracts **artifacts** — the discrete, meaningful things embedded in what you shared.

An artifact is a specific thing with a type. Not everything you type is an artifact — but the things that are get pulled out and styled.

**Artifact types:**

| Type              | What it is                                    | How it looks                |
| ----------------- | --------------------------------------------- | --------------------------- |
| YouTube video     | A YouTube link you shared                     | Embedded player / thumbnail |
| IG reel           | An Instagram link                             | Preview card                |
| Book              | A book you mentioned or linked                | Cover art + title           |
| Book page / quote | A specific passage or idea from a book        | Styled quote block          |
| Image             | A photo or screenshot you shared              | Image card                  |
| X tweet           | A tweet link                                  | Embedded tweet card         |
| Message           | A text message or conversation you referenced | Chat bubble style           |
| Voice memo        | An audio recording                            | Waveform player             |
| Song              | A song link (Spotify, Apple Music, etc.)      | Album art + title + player  |
| Album             | A full album you shared                       | Album art + tracklist       |
| Podcast           | A podcast episode link                        | Episode card + player       |
| Podcast quote     | A specific moment or quote from an episode    | Styled quote with source    |
| Freeform          | Anything else — a thought, idea, realization  | Text block, your words      |

### Step 3 — Collections + Connections

**Collections** = groupings that emerge from your artifacts. Not folders you create — categories that form naturally. Examples: Music, Design, Books, Ideas, Life Updates.

**Connections** = lines between artifacts that relate to each other (Obsidian-style). If you saved a Kendrick album and later wrote a thought about storytelling in hip-hop, those connect.

For v1:

- AI auto-assigns artifacts to collections based on content
- You can manually connect two artifacts with a line
- The view shows your collections as sections, with connection lines visible between related artifacts

---

### Tech Stack (Phase 1)

| Layer    | Pick                                                     |
| -------- | -------------------------------------------------------- |
| Frontend | Next.js + Tailwind                                       |
| Backend  | Convex                                                   |
| AI       | Claude API (artifact extraction + collection assignment) |
| Hosting  | Vercel                                                   |

### Data Model (Phase 1)

```typescript
// convex/schema.ts
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  // Raw daily entries — what you dumped in
  entries: defineTable({
    content: v.string(),
    createdAt: v.number(),
  }),

  // Extracted artifacts — the meaningful pieces
  artifacts: defineTable({
    entryId: v.id("entries"), // which entry this came from
    type: v.string(), // "youtube" | "ig_reel" | "book" | "quote" | "image" | "tweet" | "message" | "voice_memo" | "song" | "album" | "podcast" | "podcast_quote" | "freeform"
    content: v.string(), // the text, URL, or transcription
    title: v.optional(v.string()),
    description: v.optional(v.string()),
    imageUrl: v.optional(v.string()),
    metadata: v.optional(v.any()), // type-specific data (album art, embed URL, etc.)
    collection: v.optional(v.string()), // AI-assigned collection name
    createdAt: v.number(),
  }),

  // Connections between artifacts
  connections: defineTable({
    fromArtifactId: v.id("artifacts"),
    toArtifactId: v.id("artifacts"),
    label: v.optional(v.string()), // optional description of the connection
    createdAt: v.number(),
  }),
});
```

### Build Order (Phase 1)

**You already have:** the dump input + link previews.

**Next steps:**

1. **Artifact extraction** — When you save an entry, send it to Claude API. Prompt: "Extract all discrete artifacts from this text. For each, identify the type and pull out the relevant content." Save each artifact to the artifacts table linked to the entry.

2. **Artifact cards** — Render each artifact type with its own styled card. YouTube gets a thumbnail, books get cover art, quotes get a styled block, freeform gets your text. This is where it starts to look good.

3. **Collections view** — Group artifacts by their AI-assigned collection. Show them as sections on a page. Simple grid or masonry layout.

4. **Connections** — Add ability to select two artifacts and draw a connection. Show connections as lines (SVG or canvas lines between cards). This is the Obsidian energy.

---

## Phase 2: The Learning Layer

> Not building yet. Unlocks after Phase 1 is working and you have real content.

- "Go Deeper" button on any artifact
- AI researches the topic: background, context, related topics, key facts
- Results rendered as learning cards
- Save parts of what you learn → they become new artifacts in your collections
- Your corner grows from what you find AND what you learn

---

## Phase 3: iPad Canvas (Swift)

> Not building yet. Unlocks after Phase 2, when you have content + knowledge worth exploring spatially.

- SwiftUI app talking to the same Convex backend
- Spatial canvas — drag artifacts around, cluster them, zoom in/out
- Apple Pencil — draw connections freehand, annotate, sketch ideas
- Gestures — pinch to zoom into a collection, swipe between views
- Remix mode — combine artifacts to brainstorm new ideas
- This is the Figma/Tony Stark moment

---

## The Principle

Don't build the canvas until you have something worth putting on it. Don't build the learning engine until you have something worth learning about. Start with the dump. Everything else earns its way in.
