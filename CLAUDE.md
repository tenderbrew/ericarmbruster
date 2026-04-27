# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Hand-written static personal site served at `www.ericarmbruster.com` via GitHub Pages (the `CNAME` file). No build step, no bundler, no `package.json`, no test suite — every page is a stand-alone `.html` file at the repo root that the browser loads directly.

Aesthetic and structural reference is `mempool.space` — dark navy dashboard, thin-bordered panels, monospace numerical readouts. This is intentional and pervasive; new UI should match it (see the design tokens at the top of `css/styles.css`).

## Working on the site

- **Preview locally:** serve from the repo root with any static file server so relative paths (`css/...`, `images/...`, `steam-data.json`) resolve. Opening an HTML file directly via `file://` works for visual checks but breaks `fetch()` calls.
- **Steam data refresh (manual):** `node steam-fetch.js` — requires `.env` with `STEAM_API_KEY` and `STEAM_ID`. Writes `steam-data.json` (pretty-printed so daily diffs stay readable).
- **Steam data refresh (automatic):** `.github/workflows/update-steam.yml` runs daily at 08:00 UTC and on `workflow_dispatch`. Secrets are injected from repo settings; the workflow only commits if the JSON actually changed.

There is no lint or test command. Validation is "open the page in a browser and look at it."

## Architecture

### One HTML file per page, no templating

Pages: `index`, `about`, `projects`, `video-games`, `film`, `economics`, `self-hosting`, `seymour`, `bitcoin`. Navigation is plain `<a href>` between them.

The header, footer, ticker tape, and drawer markup are **duplicated across every page** — there is no shared layout or include system. When you change shared chrome (nav links, footer text, ticker tape items), update every HTML file. Grep for the markup you're changing to find every copy.

### CSS layering

1. `css/styles.css` — design tokens (CSS custom properties for colors, spacing, type scale, fonts) plus base components (`.site-header`, `.panel`, `.tag`, `.stat`, ticker tape, drawer). Loaded by every page.
2. `css/<page>-styles.css` (e.g. `vg-styles.css`, `bitcoin-styles.css`) — styles specific to one page's widgets.
3. A page-local `<style>` block in `<head>` for one-off layout (the homepage widget grid, hero, etc.).

Always reach for the tokens in `:root` (`--surface`, `--border`, `--accent`, `--bitcoin`, `--space-*`, `--font-mono`, etc.) rather than hard-coding values — it keeps the visual language consistent.

### JS layering

- **Site-wide scripts** loaded on every page:
  - `js/drawer.js` — slide-out nav drawer + desktop "interests" dropdown. Two independent IIFEs, each guards on element presence.
  - `js/ticker.js` — populates the top ticker tape with FRED series (8 macro indicators), CoinGecko BTC, Yahoo Finance DJIA. Each ticker `<span>` is matched via `data-ticker="SYMBOL"`. The HTML duplicates the ticker spans for the seamless CSS scroll, so updates target *all* matching spans.
- **Page-specific JS** is written inline as IIFEs at the bottom of each HTML file — there are no external page-specific JS files. `bitcoin.html`, `economics.html`, `film.html`, and `video-games.html` are the heaviest.

### Live data and CORS

`ticker.js` uses a **CORS-proxy fallback chain** for any source that doesn't send CORS headers (FRED, Yahoo Finance):

1. Codetabs (`api.codetabs.com/v1/proxy/?quest=...`)
2. AllOrigins `/get` (JSON-wrapped, may return data-URI payloads — handled by `decodeDataPayload`)
3. AllOrigins `/raw`

`Promise.allSettled` is used so one failed series doesn't kill the others, and individual fetches are wrapped in `try/catch` so the rest of the ticker keeps working. Apply the same pattern when adding new live data: assume external APIs will fail, degrade gracefully (leave placeholder text), and never let one failure block another fetch.

CoinGecko and `mempool.space` send CORS headers, so they're called directly without a proxy.

### The Steam pipeline

`video-games.html` does not call the Steam API at runtime. The data flow is:

```
GitHub Actions (daily) → steam-fetch.js → steam-data.json (committed) → video-games.html (fetch at page load)
```

The shape of `steam-data.json` is a contract between `steam-fetch.js` and `video-games.html`. If you change one side, change the other. Top-level keys: `fetchedAt`, `profile`, `stats` (incl. `playtimeBuckets`), `recentlyPlayed`, `topByPlaytime`.
