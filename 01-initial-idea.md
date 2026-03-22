---
created on: Saturday, March 21, 2026
note: This was the initial idea
---

# The Space — Final Vision + v1 Plan

## What It Is

Your corner of the internet. You share things you like and thoughts you have — and it becomes a personal website that you can explore deeper, learn from, and eventually share.

## The Desired Outcome

> Good software helps you get a desired outcome and reduces friction toward it.

Your desired outcome: **a personal corner of the internet that documents your thoughts, ideas, interests, and progress — and helps you learn more about the things you care about.**

The friction it removes: making that corner should feel as easy as texting yourself.

---

## What Makes This Different From Everything Else

| App           | What they do                                                     | What's missing                                                                      |
| ------------- | ---------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| **noplace**   | Colorful, customizable social profiles (MySpace energy)          | No depth — it's a profile, not a living space. No learning. No rabbit holes.        |
| **Corner**    | Curate and share places on a map                                 | Narrow to places. Your identity is more than where you eat.                         |
| **Albo**      | Save and organize things from the internet                       | Utility-focused. Helps you act on bookmarks, doesn't help you _learn_ or _express_. |
| **The Space** | Share things + thoughts → personal website that teaches you more | The "go deeper" button. The cool factor. The templates.                             |

The gap in the market: **none of these apps make you smarter about the things you already care about.** They store, organize, or display — but they don't _expand_. The Kendrick example nails it: you share an album you love, and now you can rabbit-hole into everything around it. The content you share becomes a launchpad, not a dead end.

---

## The Two Loops

### Loop 1: Share → It Appears on Your Site

- You share a link, drop a thought, or send a voice memo
- AI processes it — extracts what it is, tags topics, pulls metadata
- It shows up as a beautiful block on your personal site
- Over time, your site fills up and becomes _yours_

### Loop 2: Tap → Go Deeper → Learn More

- You see something on your canvas — say, a Kendrick Lamar album you shared
- You tap "Go Deeper"
- The Space teaches you: about Kendrick's background, the themes on the album, the genre's history, related artists, the cultural context
- You save the stuff that resonates → it goes back into your site
- Your corner grows not just from what you find, but from what you _learn_

**Loop 1 is the input engine. Loop 2 is the learning engine. Together they make the site feel alive.**

---

## The Cool Factor

This is what makes people want to be here. It's not the features — it's the feeling.

- **Beautiful templates** — Framer-quality layouts that make your corner look incredible from day one. This is the hook. People see someone's Space and think "I want one."
- **Dead-simple input** — share a link or text yourself. No forms, no friction. iMessage energy.
- **It gets smarter** — the more you add, the more your site reflects who you actually are. Topics emerge, clusters form, your interests become visible.
- **The rabbit hole** — tap anything on your canvas and go deeper. Learn something you didn't know about the thing you already love. That's the magic trick.

---

## v1 Scope: The Minimum Cool Product

### What to build

**1. The Input (texting yourself)**

- A chat-style interface: type a thought or paste a link
- AI processes it: extracts metadata from links, identifies topics from text
- It saves to your collection

**2. The Canvas (your personal site)**

- A beautiful, template-based personal page
- Shows your shared links as cards and your thoughts as quotes/blocks
- Grouped by auto-detected topics
- Looks like a Framer personal website template — clean, visual, cool

**3. The Rabbit Hole (go deeper)**

- Each block on your canvas has a "Go Deeper" button
- Tapping it uses AI to generate a learning card: context, background, related topics, key facts
- You can save parts of what you learn → they become new blocks on your canvas

### What NOT to build yet

- Social / connections / public profiles
- Voice input
- Import from YouTube/IG/Spotify
- Spatial canvas editing (Figma-style drag-and-drop)
- Custom templates (ship one good one first)

---

## Tech Stack

| Layer         | Pick                | Why                                              |
| ------------- | ------------------- | ------------------------------------------------ |
| Frontend      | Next.js + Tailwind  | Fast to build, handles the site + chat views     |
| Database      | Supabase            | Entries, auth, file storage                      |
| AI            | Claude API          | Topic extraction, "Go Deeper" content generation |
| Link previews | Open Graph scraping | Rich cards for shared URLs                       |
| Hosting       | Vercel              | Ship it fast, custom domain later                |

---

## Data Model

```
Entry
  - id
  - type (link | thought | learning)    // "learning" = saved from Go Deeper
  - raw_content (URL or text)
  - title
  - description
  - image_url (from OG tags or AI-generated context)
  - topics (array, AI-assigned)
  - metadata (JSON)
  - source_entry_id (nullable — if this came from a Go Deeper action)
  - is_public (default false)
  - created_at

Topic
  - id
  - name
  - slug
  - entry_count

SiteConfig
  - id
  - template
  - display_name
  - bio
  - topic_order
```

---

## Build Order

### Week 1: Input + Canvas

**Days 1–2: Chat input**

- Next.js project setup + Supabase
- Chat-style UI: input box, message bubbles
- Save text entries to database
- Detect URLs vs. plain text

**Days 3–4: Link processing + AI tagging**

- Scrape Open Graph data from URLs (title, image, description)
- Send entries to Claude API for topic classification
- Display link entries as rich cards in the chat

**Days 5–7: The personal site view**

- A separate page that renders your entries as a personal website
- Pick one Framer-inspired layout and build it
- Group entries by topic, newest first
- Make it look _good_ — this is where the cool factor lives

### Week 2: The Rabbit Hole

**Days 8–10: Go Deeper**

- Add a "Go Deeper" button to each block on the canvas
- On tap, call Claude API with the entry content + prompt:
  "Tell me more about this. Give me background, context, related topics, and interesting facts. Format as a learning card."
- Render the response as an expandable card or overlay
- Add a "Save to my Space" button for any piece of the learning content

**Days 11–14: Polish + use it**

- Refine the template styling
- Add topic pages (click a topic → see all entries)
- Deploy to Vercel
- Start actually using it every day

---

## The End-to-End Experience

1. You find a Kendrick Lamar album you love
2. You open The Space, paste the Spotify or YouTube link
3. It appears as a beautiful card on your site under "Music"
4. You tap "Go Deeper" — The Space teaches you about the album's themes, Kendrick's journey from Compton, the Pulitzer he won, how the album connects to West Coast hip-hop history
5. You save "Kendrick won a Pulitzer for DAMN." — it becomes a new block on your canvas
6. You tap Go Deeper on that → now you're learning about the Pulitzer Prize in music, who else has won it, why it mattered
7. Your Music section now has a rich web of content — things you found AND things you learned
8. Someone visits your Space and sees a person who doesn't just listen to music — they _understand_ it

---

## Future Roadmap

**Phase 2: Make it social**

- Public profiles with shareable URLs
- Beautiful template marketplace
- Follow other Spaces

**Phase 3: Connections**

- Discover people with overlapping interests
- "People who like this also explore..."
- Collaborative Spaces

**Phase 4: Full canvas**

- Figma-style spatial editing
- Drag blocks, draw connections
- Visual brainstorming mode

**Phase 5: Import everywhere**

- YouTube likes, Spotify history, IG saves, browser bookmarks
- Bulk-populate your Space from your existing digital life

---

## Start Here

```bash
npx create-next-app@latest the-space --typescript --tailwind --app
cd the-space && npm install @supabase/supabase-js
```

Build the chat input. Save one thought. See it appear. That's your first 2 hours.
