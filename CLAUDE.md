# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Hand-written static personal site served at `www.ericarmbruster.com` via GitHub Pages from `main` (the `CNAME` file). No build step, no bundler, no `package.json`, no test suite — every page is a stand-alone `.html` file at the repo root that the browser loads directly.

**v3 (July 2026):** the site was rebuilt from scratch in a single retro/pixel design system inspired by poolsuite.net. Everything from v1 except the Seymour memorial was torn down; the v1 pages, their data fetchers + GitHub Actions workflows, and the unshipped v2 "painted valley" redesign are all recoverable from git history (see the `archive:` and `v3: tear down` commits). Old sections (video games, film, self-hosting, economics, bitcoin) get ported back one page at a time — **into the pixel system, not as unique designs.** Every page is in the system, including the Seymour memorial.

## The v3 design system

One system for every page. Tokens live at the top of `css/pixel-base.css` — always use the variables, never hard-code colors.

- **Palette (locked by Eric):** paper `#F3EEDF`, ink `#1A1A18`, pool blue `#2E6FBF`, sunset orange `#E8743B`, plus derived `--paper-dim` for panel fills. Shadows are always solid black offsets (`box-shadow: 4px 4px 0`) — never blurred.
- **Type:** DotGothic16 (Google Fonts) for display/nav/labels, **integer pixel sizes only** (48/32/24/16 — the face is drawn on a grid; fractional sizes blur it). IBM Plex Mono for body text and tables.
- **Ornament:** hand-placed pixel art as inline SVG with `shape-rendering: crispEdges` — the masthead sun-over-water scene (index), the `.px-wave` divider, `.px-bullets` sprite bullets. No border-radius anywhere in the system.
- **Images:** photos get pre-dithered into the 4-color palette via `node tools/dither.js input.jpg output.png [width]` (one-time `npm install sharp`; keep output widths small, ~160px, and scale up with `image-rendering: pixelated`). Commit the dithered PNG as the asset.
- **Chrome decisions Eric made explicitly:** hard offset shadows and pixel dividers/ornaments YES; beveled 3D buttons and custom pixel cursors NO.
- **Motion:** static CSS only — no scroll-jacking, parallax, entrance animations, or JS-driven layout. The single sanctioned animation is the masthead block-cursor blink (`steps()`-based), disabled under `prefers-reduced-motion`. Hover states are fine.

### Seymour: pixel chrome, untouched photographs

`seymour.html` is in the pixel system (Eric asked for this explicitly after initially exempting it), with one hard rule: the 30 memorial photographs stay **full-color and undithered** — Eric's explicit call. Thumbnails are square (`aspect-ratio: 1; object-fit: cover; height: auto` — the `height: auto` matters, or the `height="400"` attribute wins) in hard-shadow frames; `image-rendering: auto` on them, not `pixelated`. Its lightbox is an inline IIFE at the bottom of the file; the old Tufte-era stylesheets (`tufte-base.css`, `sy-styles.css`) were deleted with it.

## Pages

- `index.html` — home: intro, sections TOC, elsewhere links, Seymour pointer. Carries the canonical head conventions: OG/twitter meta, `theme-color #F3EEDF`, gtag `G-5ZTHJXDR9V`, hector favicon. The blinking masthead cursor is homepage-only (`.masthead--home`).
- `now.html` — hand-edited "what I'm up to": one paragraph + date, replaced whenever.
- `video-games.html` — hydrates from `steam-data.json` (see pipelines below).
- `film.html` — hydrates from `film-data.json`; posters hotlink Letterboxd's CDN.
- `reading.html` — hydrates from `reading-data.json` (Goodreads shelves; covers hotlink Goodreads' CDN).
- `music.html` — hydrates from `music-data.json` (Plex listening history via Tautulli).
- `self-hosting.html` — hydrates from `services-data.json` (the homelab's own container inventory); the GROUPS/DESCRIPTIONS maps in the page are the editorial layer.
- `economics.html` — hydrates from `econ-data.json` (FRED + Mises RSS); `indicatorDefinitions` in the page must stay in sync with `SERIES_IDS` in `econ-fetch.js`.
- `bitcoin.html` — hydrates from `btc-data.json`; draws the 90d SVG polyline at hydration.
- `family-tree.html` — hand-edited distillation of `Documents/ancestry/tree.md` (outside this repo). **Deceased ancestors only; living relatives appear as "(living)", unnamed.**
- `hector.html` — hand-edited photo page (template figure in a comment); uses the shared `.px-gallery`.
- `seymour.html` — memorial, pixel chrome with untouched photos (see above).
- `404.html` — GitHub Pages not-found page, pixel system, `noindex`, **absolute** asset paths (`/css/...`) because it serves at any path.
- Retro Game Club is deliberately NOT a page here — it links out to nintendopipeline.club (its own repo/site) from the homepage TOC.

## Data pipelines

Same architecture as v1: GitHub Actions run the fetcher on a schedule, commit the JSON, and the page `fetch()`es it at load — the browser never calls upstream APIs. On successful render the page sets `data-hydrated="<name>"` on `<main>` (asserted by `tools/screenshot.js`); the failure message is JS-injected only on failure (a hidden static fallback string would trip the `mustNot` check).

| Page | Fetcher | Data file | Workflow | Schedule |
|---|---|---|---|---|
| `video-games` | `steam-fetch.js` (needs `.env` `STEAM_API_KEY`/`STEAM_ID` locally; Action uses repo secrets) | `steam-data.json` | `update-steam.yml` | daily 08:00 UTC |
| `film` | `film-fetch.js` (no key) | `film-data.json` | `update-film.yml` | every 6 hours |
| `reading` | `reading-fetch.js` (no key; public Goodreads shelf RSS `/review/list_rss/22369018` — empty `user_shelves` in the feed means shelf "read") | `reading-data.json` | `update-reading.yml` | daily 09:15 UTC |
| `economics` | `econ-fetch.js` (no key) | `econ-data.json` | `update-econ.yml` | every 6 hours |
| `bitcoin` | `btc-fetch.js` (no key) | `btc-data.json` | `update-btc.yml` | every 3 hours |

**Homelab-fed pages** (no GitHub Action — Actions can't reach the LAN). Refresh by running the export script from the dev box, then commit the JSON; secrets are read on the homelab and never leave it:

| Page | Script | Data file | Source |
|---|---|---|---|
| `self-hosting` | `tools/export-services.sh` | `services-data.json` | `docker ps` names + compose projects over SSH (`tenderbrew@192.168.1.101`); sidecars filtered; **never publish ports/IPs/versions** |
| `music` | `tools/export-music.sh` | `music-data.json` | Tautulli `get_history` (API key read on-homelab from its config.ini) |

Gotcha that broke the first version of these scripts: `ssh ... | python - "$OUT" <<'PY'` does NOT work — the heredoc steals stdin from the pipe. Write ssh output to a mktemp file and pass the path to python. Also use `command -v python || command -v python3` on this Windows box (bare `python3` resolves to the broken Microsoft Store shim).

JSON shape is a contract between fetcher and page — change both sides together. Because these workflows commit to `main`, `git pull --rebase origin main` before pushing.

Shared pixel components for data pages live in `pixel-base.css`: `.px-stats`/`.px-stat` (stat tiles), `.px-table` (bordered tables), `.px-bar-row` (single-series chunky bars). Gotcha: `ul.px-bullets li` owns `padding-left` for the sprite bullet — page styles must only set `padding-top/bottom` on those `li`s or the bullet overlaps the text.

When adding a page: copy index.html's head block, load `css/pixel-base.css`, put page-specific styles in a `<style>` block in the head, add the page to `sitemap.xml` and to `ALL_PAGES` in `tools/screenshot.js`. There is no shared-layout include system — header/footer markup is duplicated per page, so grep and update every copy when changing shared chrome.

## Working on the site

- **Preview locally:** serve the repo root with any static server (`python -m http.server`); `file://` also works now that no page fetches JSON at runtime.
- **Visual check (headless):** `node tools/screenshot.js [pages…]` → `screenshots/check-<page>.png` (git-ignored). This is how to actually *see* a UI change instead of only claiming it works.
- There is no lint or test command. Validation is "open it in a browser" or the screenshot tool. If you change UI and genuinely can't preview it, say so explicitly rather than claiming success.

## Durable preferences (Eric's, standing)

- **One coherent system, not unique-per-page designs.** (This reverses the v1-era guidance; Eric is explicitly over per-section skins.)
- **Plain, professional copy.** No twee voice, no "kept by hand", no character asides. Eric removes these on sight.
- **Don't invent biographical details, inventory items, or hardware model numbers.** Use what's in the repo, in memory, or ask.
- **No AI co-author trailers in commit messages.**
