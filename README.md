# ericarmbruster.com

My personal website — a hand-written static site served at
[www.ericarmbruster.com](https://www.ericarmbruster.com) from this repo's `main`
branch via GitHub Pages (see `CNAME`).

There is no build step, no bundler, and no `package.json`. Every page is a
stand-alone `.html` file at the repo root that the browser loads directly.

## v3 (July 2026)

The site was rebuilt from scratch in July 2026 in a **retro/pixel** design
system (poolsuite.net-inspired). Everything from v1 was removed (the Seymour memorial was rebuilt in the
new system with its photographs untouched); old sections (video games,
film, self-hosting, economics, bitcoin) will be ported back one at a time. The v1 pages, their
data fetchers/workflows, and the unshipped v2 "painted valley" redesign all
live in git history.

## Pages

- `index.html` — single-page home: intro, links, Seymour pointer.
- `seymour.html` — photo-essay memorial for Seymour (2010–2025), in the
  pixel system. The memorial photographs themselves stay full-color and
  undithered, mounted in hard-shadow frames.
- `404.html` — GitHub Pages not-found page, in the pixel system.

## The design system

Tokens live at the top of `css/pixel-base.css`:

- **Palette:** cream paper `#F3EEDF`, soft-black ink `#1A1A18`, pool blue
  `#2E6FBF`, sunset orange `#E8743B`. Shadows are solid black offsets
  (`4px 4px 0`), never blurred.
- **Type:** DotGothic16 for display/nav/labels at integer pixel sizes only;
  IBM Plex Mono for body text and tables. Both from Google Fonts.
- **Ornament:** hand-placed pixel art as inline SVG with
  `shape-rendering: crispEdges` (masthead sun-over-water, wave dividers,
  sprite bullets). No border-radius anywhere.
- **Images:** photos are pre-dithered into the palette with
  `node tools/dither.js input.jpg output.png [width]` (needs a one-time
  `npm install sharp`; `node_modules` is git-ignored) and rendered with
  `image-rendering: pixelated`.
- **Motion:** static CSS only. The single animation is the masthead block
  cursor (steps-based blink), disabled under `prefers-reduced-motion`.

## Preview

Serve the repo root with any static file server (`python -m http.server`)
or open the files directly — there are no runtime data fetches anymore.
`node tools/screenshot.js` renders pages headlessly to `screenshots/`
(git-ignored) for a visual check.
