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

## Data updates

| Cadence | What |
|---|---|
| real-time | guestbook + the footer visit counter (both self-hosted on my homelab behind a Cloudflare tunnel; guestbook is Discord-moderated) |
| every 3h | bitcoin |
| every 6h | film, economics, music + self-hosting (homelab cron → tunnel export → Action) |
| daily | video games |
| manual | reading (local Goodreads CSV import; see below) |

Scheduled GitHub Actions commit refreshed JSON for the automated pages; reading
is an offline, manually published snapshot. Pages hydrate from those baked files
at load — the browser never calls upstream APIs.

## Reading: private export, local import, manual publishing

The Goodreads RSS fetcher and scheduled reading update have been retired. The
existing `reading-data.json` is retained until an actual export is supplied; a
validation run is not a data refresh. Export your library from Goodreads' **My
Books → Import and export → Export Library**, then download the CSV locally.
Keep it outside this repository in a private location. CSV files (any extension
case) are git-ignored as a second safeguard, not a substitute for keeping them
private. Never upload exports to Actions, attach them to issues, force-add them,
or paste their contents into logs. Tests generate synthetic data only.

From the repository root, using Python 3.10+ (standard library only) for the
importer and Node.js 22 for the page hydration regression tests:

```sh
python3 -m unittest discover -s tests -p 'test_*.py' -v
node --test tests/reading-page.test.js
python3 tools/import_goodreads.py --validate
python3 tools/import_goodreads.py --csv /private/path/goodreads_library_export.csv --check
python3 tools/import_goodreads.py --csv /private/path/goodreads_library_export.csv
git diff -- reading-data.json
```

`--csv` is always explicit: there is no discovery, network fallback, credential
or automatic download. `--output /path/to/existing-snapshot.json` can target an
existing local copy for review instead. Both `--validate` and `--check` are
read-only. Validation checks the public contract; check mode also validates every
CSV row and the proposed merge. Failures return nonzero without replacing the
snapshot; diagnostics do not print source values or paths.

The importer accepts UTF-8/BOM, RFC-style CSV quotes, commas and multiline cells,
spreadsheet-quoted IDs/ISBNs, and full dates in `YYYY/MM/DD` or `YYYY-MM-DD` form.
It requires the standard `Book Id`, `Title`, `Author`, `My Rating`, `Date Read`,
`Date Added`, `Bookshelves`, and `Exclusive Shelf` headers. Missing dates may be
blank; unknown exclusive shelves, malformed values/rows, inconsistent standard
shelves and ambiguous/conflicting duplicates fail closed. Custom bookshelves are
not published. ISBN/ISBN13, when present, are format-checked but not published.
Only title, author, book link, rating, dates and standard shelf are imported.
Reviews, private notes, ownership, purchase fields and all other columns are
ignored. New books have `cover: null`; there is no cover/network lookup.

Merge rules deliberately avoid deletion: omitted books remain, and an explicit
standard shelf moves a matched book. Stable Goodreads **book** IDs match existing
book links first; legacy **review** IDs are never mistaken for book IDs. A unique
normalized title/author match can identify a legacy review-link entry. Existing
links and covers survive, as do dates absent from the CSV. A title/author match
cannot overwrite a different known book ID (edition). Identical duplicates are
collapsed; conflicting IDs, ambiguous names, or multiple rows matching one old
entry fail. Retained order stays stable, with new books appended in export order.
Legacy review URLs cannot store an additional book ID within the unchanged JSON
contract: renamed legacy books may require manual identity review rather than
guessing. Unwanted non-excluded entries must be removed by a deliberate manual
JSON edit; missing CSV rows never request deletion.

Titles matching `/\bForever\s+Fairies\b/i` are excluded from imports **and retained
data before each shelf partition**. This is the only automatic removal policy.
Empty/header-only exports fail; a valid nonempty export containing only excluded
titles can remove existing excluded entries but cannot erase other books.
Changed snapshots use a same-directory temporary file and atomic replace. Exact
no-ops leave bytes, file modification time and `fetchedAt` untouched; `fetchedAt`
means last snapshot data change, not last validation or last Goodreads export.
An existing valid snapshot is required (including its profile URL), preventing an
invalid/missing baseline from being silently replaced. Keep a backup and do not
edit/import the same snapshot concurrently.

After reviewing the JSON diff, run validation/tests again, preview `reading.html`
using a local static server, and explicitly stage **only** `reading-data.json`
when publishing data. Review staged changes before committing/pushing through
the normal site process. Never stage the export. GitHub Pages publishes the
committed snapshot; no Action imports private CSVs or commits reading updates.
The manual **Validate Reading Snapshot** workflow runs synthetic tests and
validates existing JSON with read-only permissions, no secrets and no refresh.
The **CI Reading Importer** workflow runs the same checks on relevant pushes/PRs.

## Development

- Preview: any static server from the repo root (`python -m http.server`).
- Visual check: `node tools/screenshot.js [pages…]` renders every page
  headlessly and asserts the data pages actually hydrated.
- Everything else an agent needs — design tokens, sprite methodology,
  pipelines, gotchas, the secrets registry — is in [`CLAUDE.md`](CLAUDE.md).
