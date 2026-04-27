# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Hand-written static personal site served at `www.ericarmbruster.com` via GitHub Pages (the `CNAME` file). No build step, no bundler, no `package.json`, no test suite — every page is a stand-alone `.html` file at the repo root that the browser loads directly.

Visual language is **Tufte-warm aged paper**: aged-tan surface (`--paper #ddc89a`), warm near-black ink, EB Garamond serif body, IBM Plex Mono only for true tabular data, a single manuscript red (`--accent-red #7a1c1c`) reserved for emphasis, and one spot color per "room" (`--c-vg`, `--c-film`, `--c-econ`, `--c-sh`, `--c-seymour`, `--c-bitcoin`, `--c-projects`, `--c-about`). Tokens live at the top of `css/tufte-base.css`. Always reach for the tokens; don't hard-code colors.

Pages: `index`, `about`, `projects`, `video-games`, `film`, `economics`, `self-hosting`, `seymour`, `bitcoin`. Body class is `.<page>-page` on every sub-page; homepage has plain `<body>`.

## Working on the site

- **Preview locally:** serve from the repo root with any static file server so relative paths (`css/...`, `images/...`, `steam-data.json`, `econ-data.json`) resolve. `file://` works for visual checks but breaks `fetch()` for the JSON files.
- **Steam data refresh (manual):** `node steam-fetch.js` — needs `.env` with `STEAM_API_KEY` and `STEAM_ID`. Writes pretty-printed `steam-data.json`.
- **Steam data refresh (automatic):** `.github/workflows/update-steam.yml` runs daily at 08:00 UTC.
- **Economics data refresh (manual):** `node econ-fetch.js` — no env vars required. Writes pretty-printed `econ-data.json` (FRED indicators + Mises Wire RSS).
- **Economics data refresh (automatic):** `.github/workflows/update-econ.yml` runs every 6 hours.
- *Heads-up*: because both workflows commit back to `main`, upstream often has commits you don't have locally — `git pull --rebase origin main` before pushing.

There is no lint or test command. Validation is "open it in a browser." If you make UI changes you can't preview yourself, say so explicitly rather than claiming success.

## Architecture

### One HTML file per page, no templating

Navigation is plain `<a href>` between files. The site header markup (`.site-header` containing `.site-utility` icons + `.site-shelf` mini-bookshelf) and the site footer are **duplicated across every page** — there is no shared layout or include system. When you change shared chrome, grep for the markup and update every copy. The current page is marked with `aria-current="page"` on the matching utility icon and/or shelf book.

The homepage has the *full* large bookshelf as its main content, so its header has the utility icons but **no mini shelf**. Sub-pages have both. `.site-header__inner { min-height: 42px }` keeps header height consistent between the two.

### CSS — what's live and what's vestigial

**Live, loaded by HTML:**
- `css/tufte-base.css` — loaded by every page. Design tokens, typography, `.site-header`, `.site-utility`, `.site-shelf`, `.site-footer`, base anchor styles. This is the only universal stylesheet.
- `css/sy-styles.css` — loaded *only* by `seymour.html` (the photo-essay memorial page). Cormorant Italic, photo-essay layouts.

**Vestigial — NOT loaded by any HTML:**
- `css/styles.css`, `css/vg-styles.css`, `css/bitcoin-styles.css`, `css/econ-styles.css`, `css/film-styles.css`, `css/sh-styles.css`, `css/proj-styles.css`, `css/about-styles.css` — all leftover from the prior mempool-style dark dashboard. Kept around but not active. **Don't edit these expecting changes to ship**; don't link them back in without a reason. They're worth touching only if you're explicitly cleaning them up.

Page-specific styles for everything except seymour live in a `<style>` block in the page's `<head>`. That's where to put per-page widget styling.

### Two CSS gotchas to avoid

1. **Per-page link colors must be scoped to `main`.** The base anchor uses the page's spot color. If you write `.vg-page a { color: var(--c-vg) }` it cascades into the site-header anchors too and turns the utility icons / shelf books that color (which is unreadable on several pages). **Always write `.<page>-page main a { ... }`.** Same goes for `:hover`. Search for an existing page's `main a` rule before adding a new one.
2. **Shelf book backgrounds need the `background:` shorthand.** The base `a` rule sets `background-size: 100% 1px` (underline trick). If `.site-shelf__book` only sets `background-image:`, that 1-pixel size is inherited and clips the cloth gradient to a strip. The current rule uses the `background:` shorthand (which resets all bg sub-properties); preserve that. Same trap if you add other elements that ride on `<a>` and use a gradient.

### JS — what's live and what's vestigial

- **Live:** Google Analytics inline snippet in every `<head>`. The `video-games.html` inline IIFE that fetches `steam-data.json` at page load.
- **Vestigial:** `js/drawer.js` and `js/ticker.js` — the slide-out nav drawer and FRED/CoinGecko ticker tape from the dashboard era. Not referenced from any HTML. Don't add them back without a reason.

Page-specific JS is written inline as IIFEs at the bottom of each HTML file; there are no external page-specific JS files.

### The Steam pipeline

`video-games.html` does not call the Steam API at runtime. The flow is:

```
GitHub Actions (daily) → steam-fetch.js → steam-data.json (committed) → video-games.html (fetch at load)
```

Shape of `steam-data.json` is a contract between `steam-fetch.js` and `video-games.html`. If you change one side, change the other. Top-level keys: `fetchedAt`, `profile`, `stats` (incl. `playtimeBuckets`), `recentlyPlayed`, `topByPlaytime`.

### The economics pipeline

Same shape as Steam. `economics.html` does not hit FRED or the Mises feed at runtime — it reads a pre-baked JSON file:

```
GitHub Actions (every 6h) → econ-fetch.js → econ-data.json (committed) → economics.html (fetch at load)
```

Why pre-baked: the previous version fetched ~30 FRED CSVs through public CORS proxies (AllOrigins/Codetabs) at every page load, which timed out frequently. Server-side fetching needs no proxy and no API key (FRED's CSV endpoint is open).

Shape of `econ-data.json`:
- `fetchedAt` — ISO timestamp of the cron run
- `indicators` — object keyed by FRED series ID. Each entry is `{ latest: {date, value}, previous: {date, value} | null }` or `null` if that series failed. CPI_YOY is computed from CPIAUCSL server-side.
- `news` — array of up to 10 `{ title, link, pubDate, kind }` from the Mises RSS. `kind` is "Mises Wire" / "Podcast" / "Article" / "Update", classified by URL path.

The `indicatorDefinitions` array in `economics.html` is the display contract (name, unit, decimals, transform, derived?). Order there drives card order. The series ID list in `econ-fetch.js` (`SERIES_IDS`) must stay in sync with non-derived definitions on the page. The top-of-page tape strip hydrates from the same data via `[data-tape="SERIES_ID"]` cells.

## Design preferences (durable)

- **Skeuomorphic charm over flat uniformity.** Each section gets one or two unique, hand-crafted touches (book spines on the homepage shelf, tipped-in portraits, postcards, ledgers). Don't unify pages with a single repeating component.
- **Static CSS only.** No scroll-jacking, no parallax, no entrance animations, no JS-driven layout. Hover states are fine; motion-on-scroll is not.
- **Plain, professional copy.** No twee voice, no "kept by hand" / "by the spirit" / character asides about Hector. Eric removes these on sight.
- **Don't invent biographical details, inventory items, or hardware model numbers.** Use what's in the repo, in memory, or ask. This applies to the self-hosting service list, About-page bio, and any "what I use" content.
