# ericarmbruster.com

My personal website — a hand-written static site served at
[www.ericarmbruster.com](https://www.ericarmbruster.com) from this repo's `main`
branch via GitHub Pages (see `CNAME`).

There is no build step, no bundler, and no `package.json`. Every page is a
stand-alone `.html` file at the repo root that the browser loads directly, so
each file is a live URL and the relative paths (`css/…`, `images/…`,
`*-data.json`) must keep resolving.

## Pages

Nine live pages, one `.html` file each at the repo root:

`index`, `about`, `projects`, `video-games`, `film`, `economics`,
`self-hosting`, `seymour`, `bitcoin`.

The homepage is a `<body>` with no page class; every sub-page carries a
`.<page>-page` body class. The header (`.site-header` with utility icons and a
mini bookshelf) and footer markup are **duplicated byte-for-byte across all nine
pages** — there is no shared layout or include system, so shared chrome is edited
in every copy.

> `v2/` is a separate in-progress redesign; it is noindexed (`robots.txt`
> disallows `/v2/`) and not part of the live site.

## Tech

- **No build.** Plain HTML/CSS, with page-specific JavaScript written inline as
  IIFEs at the bottom of each file. No external page-specific JS.
- **Typography.** EB Garamond (serif body, every page) + IBM Plex Mono (true
  tabular data only). Two rooms add a third face on purpose: `film.html` loads
  Playfair Display for theatrical headings, and `bitcoin.html` loads Inter for
  its dashboard body text.
- **Aesthetic.** A Tufte-inspired aged-paper look — warm tan surface, near-black
  ink, a single manuscript red for emphasis, and one spot accent color per
  "room." Design tokens live at the top of `css/tufte-base.css`; per-page link
  colors are scoped to `.<page>-page main a`.
- **CSS.** `css/tufte-base.css` is loaded by every page (tokens, typography,
  header/footer, base anchors). `css/sy-styles.css` is loaded only by
  `seymour.html`. All other per-page styling lives in a `<style>` block in that
  page's `<head>`.

## Data pipelines

Four pages render data that is fetched on a schedule, committed to the repo as
JSON, and then read by the page at load — the browser never calls these
upstream APIs directly:

```
GitHub Actions (cron) → <name>-fetch.js → <name>-data.json (committed) → <page>.html (fetch at load)
```

| Page            | Fetcher          | Data file         | Source                          | Workflow                          | Schedule        |
| --------------- | ---------------- | ----------------- | ------------------------------- | --------------------------------- | --------------- |
| `video-games`   | `steam-fetch.js` | `steam-data.json` | Steam Web API                   | `.github/workflows/update-steam.yml` | daily 08:00 UTC |
| `economics`     | `econ-fetch.js`  | `econ-data.json`  | FRED indicators + Mises Wire RSS | `.github/workflows/update-econ.yml`  | every 6 hours   |
| `bitcoin`       | `btc-fetch.js`   | `btc-data.json`   | Bitcoin / market data           | `.github/workflows/update-btc.yml`   | every 3 hours   |
| `film`          | `film-fetch.js`  | `film-data.json`  | Letterboxd RSS + profile pages  | `.github/workflows/update-film.yml`  | every 6 hours   |

Run any fetcher manually with `node <name>-fetch.js`; each writes its
pretty-printed JSON file. Only `steam-fetch.js` needs credentials — a `.env`
with `STEAM_API_KEY` and `STEAM_ID` (git-ignored). The others require no API key.

Because these workflows commit back to `main`, upstream often has commits you
don't have locally — `git pull --rebase origin main` before pushing.

## Preview and visual check

- **Preview locally:** serve the repo root with any static file server so the
  relative paths and the `fetch()` of the `*-data.json` files resolve. Opening
  via `file://` works for a quick look but breaks the JSON fetches.
- **Headless render + screenshot (no install):** `node tools/screenshot.js`
  spins up a throwaway local server, drives the system Chrome/Edge, and saves
  `screenshots/check-<page>.png` for each page. It defaults to all nine pages
  (pass names to limit, e.g. `node tools/screenshot.js bitcoin film`) and
  asserts that the data-driven pages (bitcoin, film, seymour) actually hydrated
  rather than falling back. The `screenshots/` output is git-ignored.

There is no lint or test command — validation is opening the page in a browser
or running the screenshot tool.

## More detail

See [`CLAUDE.md`](CLAUDE.md) for the deeper architecture notes: design tokens
and the per-room color system, the duplicated-header conventions, CSS/JS gotchas,
the exact shape of each data file, and durable design preferences.
