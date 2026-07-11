# ericarmbruster.com

My personal website — a hand-written static site served at
[www.ericarmbruster.com](https://www.ericarmbruster.com) from this repo's `main`
branch via GitHub Pages (see `CNAME`). No build step, no bundler, no framework:
every page is a stand-alone `.html` file the browser loads directly.

## v3 — "the pixel rebuild" (July 2026, v1.0)

A retro/pixel design system inspired by poolsuite.net: four colors
(cream / ink / pool blue / sunset orange), DotGothic16 + IBM Plex Mono,
hand-placed pixel-art sprites, checkerboard-dithered shadows. The homepage is
a little desktop — section tiles open pages in Motif/CDE-style windows — and
the whole site follows the clock at my house: **day, dusk, and night** looks
that switch on Eastern time (clicking the sun cycles them).

Earlier eras (v1 "the bookshelf", v2 "the valley", never shipped) live in git
history — and in a hidden museum page somewhere on the site. There are several
other secrets. Happy hunting.

## Pages

**Sections (the dock):** video games (Steam), film (Letterboxd),
reading (Goodreads), music (Plex), self-hosting (the homelab's own inventory),
family tree, economics (FRED), bitcoin.

**Everything else:** now, hector, guestbook, the Seymour memorial, a styled
404, and a couple of unlisted pages you have to find.

## How it stays fresh (all zero-touch)

| Cadence | What |
|---|---|
| real-time | guestbook (self-hosted on my homelab behind a Cloudflare tunnel, Discord-moderated) |
| every 3h | bitcoin |
| every 6h | film, economics, music + self-hosting (homelab cron → tunnel export → Action) |
| daily | video games, reading |

GitHub Actions commit refreshed JSON; pages hydrate from those baked files at
load — the browser never calls upstream APIs.

## Development

- Preview: any static server from the repo root (`python -m http.server`).
- Visual check: `node tools/screenshot.js [pages…]` renders every page
  headlessly and asserts the data pages actually hydrated.
- Everything else an agent needs — design tokens, sprite methodology,
  pipelines, gotchas, the secrets registry — is in [`CLAUDE.md`](CLAUDE.md).
