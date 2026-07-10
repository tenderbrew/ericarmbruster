# v2 — "The Valley"

A parallel rebuild of ericarmbruster.com. Radically different approach from the
current Tufte-paper site: instead of typography-first pages that each wear a
different costume (noir cinema, CRT green, Bloomberg amber, server rack), v2 is
**one continuous painted world** — a romantic landscape of a Pennsylvania
valley at the golden hour, with Eric's life placed inside it.

## The concept

The homepage *is* the painting: a full-viewport, hand-built layered SVG
landscape (luminous sky, low sun, ridges fading into haze, a creek catching
the light, hardwood forest, hayfields). Every section of the site exists as a
small landmark in the scene:

| Landmark | Section | Why |
|---|---|---|
| Drive-in screen at the meadow's edge | Film | Jaws / The Thing / monster-movie canon — drive-in cinema |
| Cabin with a warm flickering window | Video Games | the CRT glow at the wood's edge |
| Depot office with telegraph poles | Economics | market data as wires coming into a valley town |
| Lantern-lit mine mouth in the hillside | Bitcoin | mining, blocks, tunnels |
| Barn with an antenna mast (red beacon) | Self-hosting | the homelab, honestly rural |
| Small dog on the far hill, first star above | Seymour | the sentinel watching over the valley |
| Border terrier trotting the foreground path | About | Hector, with the keeper of the place |

Plus: a rain veil (virga) over the far ridge — *"Listener of rain"* — the great
tree on the right ridge (Totoro's camphor, as a PA white oak), fireflies in the
foreground meadow (Dazed and Confused's summer dusk), and a sky with real
atmosphere. A plain text nav always sits with the painting, so nothing is ever
hidden behind hunting.

**The painting follows the visitor's clock.** Four states — dawn, day, dusk,
night — chosen by local hour, with a manual toggle. CSS custom properties feed
the SVG gradient stops; night brings out stars and window-light, dawn brings
mist. This is the one "fun" interaction: the site is alive without a single
scroll trick.

Sub-pages stay inside the same world: each opens with a painted vignette of
its landmark (same palette system, same clock), then content on warm ivory
below — airy, readable, simple. The paint lives in the vignettes; the content
layer stays calm.

## Design language

- **Palette** — golden-hour romantic: dusk-blue zenith `#2e3460` → violet →
  rose → peach → gold horizon `#f7d08a`; ridge layers from hazy blue
  `#8a92ac` back to umber silhouette `#2c2418`. Content ground: warm ivory
  `#f6efe2`, ink `#2b2418`, accents: lantern `#c97b2d`, gold `#a07c3a`,
  rose madder `#a13d4e`, moss `#5f6b42`, dusk blue `#3d4668`.
- **Type** — Fraunces (display; soft, slightly wonky 19th-century warmth),
  Newsreader (body; fine italics), IBM Plex Mono (tabular figures only).
- **Copy** — plain and professional, ported verbatim from the current site
  wherever it exists. The romance is visual, never verbal.
- **Motion** — ambient only (fireflies, star twinkle, beacon pulse), all gated
  behind `prefers-reduced-motion`. No scroll-jacking, no parallax, no entrance
  animations.
- **Nothing invented** — every film, game, service, and biographical fact
  comes from the current site, his public profiles, or the data pipeline.

## Data — complete automation, zero maintenance

Four JSON files at the repo root, all baked by GitHub Actions, no CORS
proxies, no API keys except the Steam key already in repo secrets:

| File | Source | Script | Schedule |
|---|---|---|---|
| `steam-data.json` | Steam Web API | `steam-fetch.js` (existing, untouched) | daily 08:00 UTC |
| `econ-data.json` | FRED CSV + Mises RSS | `econ-fetch.js` (existing, untouched) | every 6h |
| `film-data.json` | Letterboxd RSS + profile | `film-fetch.js` (new) | every 6h |
| `btc-data.json` | mempool.space + CryptoCompare + CoinDesk RSS | `btc-fetch.js` (new) | every 3h |

The new fetchers keep the previous JSON section when a source fails, so a bad
scrape can never blank the site. The bitcoin page additionally does one
runtime fetch to `mempool.space/api/v1/prices` (CORS-open, keyless) for a live
spot price, falling back to the baked figure. The film page drops the current
site's fragile runtime proxy chain (rss2json → codetabs → allorigins) entirely.

## Files

```
v2/
  index.html            the panorama
  film.html  video-games.html  economics.html  bitcoin.html
  self-hosting.html  seymour.html  about.html  projects.html
  css/valley.css        tokens (incl. 4 time-of-day modes), type, chrome
  js/valley.js          time-of-day clock + toggle (~40 lines)
  DESIGN.md             this file
film-fetch.js           new fetcher (repo root, beside existing ones)
btc-fetch.js            new fetcher
.github/workflows/update-film.yml, update-btc.yml
```

v2 references photos from `../images/` (Hector, Seymour gallery) — resolves
both locally and at `/v2/` on GitHub Pages. Existing site and workflows are
untouched; promotion later is a file move plus two path edits in workflows.
