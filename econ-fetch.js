#!/usr/bin/env node
/*
 * econ-fetch.js — Fetches FRED indicators + the Mises Wire RSS, writes econ-data.json.
 * Runs via GitHub Actions (update-econ.yml) or locally with `node econ-fetch.js`.
 * The economics.html page consumes the output JSON at runtime.
 *
 * No API key required — FRED's public CSV endpoint is open. Both feeds are hit
 * server-side so the browser never needs CORS proxies.
 */

const fs = require('fs');
const path = require('path');

// Same suite the page used to fetch from the browser. CPI_YOY is computed below
// from CPIAUCSL — keep this list in sync with indicatorDefinitions in economics.html.
const SERIES_IDS = [
  'UNRATE', 'PAYEMS', 'JTSJOL', 'ICSA',
  'CPIAUCSL', 'CPILFESL', 'T10YIE',
  'PCE', 'M2SL', 'BOGMBASE', 'WALCL',
  'FEDFUNDS', 'DGS2', 'DGS10', 'T10Y2Y', 'DFII10',
  'BAMLH0A0HYM2', 'MORTGAGE30US',
  'GDPC1', 'INDPRO', 'RSAFS', 'UMCSENT', 'STLFSI4',
  'DTWEXBGS', 'PERMIT', 'GFDEGDQ188S',
  'VIXCLS', 'BOPGSTB', 'M2V'
];

const FRED_BASE = 'https://fred.stlouisfed.org/graph/fredgraph.csv?id=';
const MISES_FEED = 'https://mises.org/feed';
const USER_AGENT = 'ericarmbruster.com econ-fetch/1.0';

function parseFredCsv(csvText) {
  const lines = csvText.split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return [];
  return lines.slice(1).map(function (line) {
    const parts = line.split(',');
    if (parts.length < 2) return null;
    const value = Number(parts[1]);
    if (!Number.isFinite(value)) return null;
    return { date: parts[0], value: value };
  }).filter(Boolean);
}

async function fetchFred(seriesId) {
  // One retry — FRED occasionally 503s under load.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const r = await fetch(FRED_BASE + encodeURIComponent(seriesId), {
        headers: { 'User-Agent': USER_AGENT }
      });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const csv = await r.text();
      const points = parseFredCsv(csv);
      if (!points.length) throw new Error('No data points');
      return points;
    } catch (err) {
      if (attempt === 1) throw err;
      await new Promise(function (resolve) { setTimeout(resolve, 1500); });
    }
  }
}

function summarize(points) {
  const latest = points[points.length - 1];
  const previous = points.length > 1 ? points[points.length - 2] : null;
  return { latest: latest, previous: previous };
}

// CPI year-over-year — server mirror of the old client-side findCpiYoY.
function cpiYoY(points) {
  if (!points.length) return null;
  const latest = points[points.length - 1];
  const target = new Date(latest.date + 'T00:00:00');
  target.setFullYear(target.getFullYear() - 1);
  let prior = null;
  for (let i = points.length - 2; i >= 0; i -= 1) {
    const pd = new Date(points[i].date + 'T00:00:00');
    if (pd <= target) { prior = points[i]; break; }
  }
  if (!prior) return null;
  return {
    latest: { date: latest.date, value: ((latest.value / prior.value) - 1) * 100 },
    previous: null
  };
}

function classifyNewsItem(link) {
  if (!link) return 'Update';
  if (link.indexOf('/mises-wire/') !== -1) return 'Mises Wire';
  if (link.indexOf('/podcasts/') !== -1) return 'Podcast';
  return 'Article';
}

// Lightweight RSS parser — extracts <item> blocks then title/link/pubDate.
// Avoids pulling in a full XML dep; the Mises feed is well-formed.
function parseRssItems(xmlText) {
  const items = [];
  const itemRe = /<item[\s\S]*?<\/item>/gi;
  const titleRe = /<title>([\s\S]*?)<\/title>/i;
  const linkRe = /<link>([\s\S]*?)<\/link>/i;
  const dateRe = /<pubDate>([\s\S]*?)<\/pubDate>/i;
  const cdataRe = /^<!\[CDATA\[([\s\S]*?)\]\]>$/;
  function unwrap(s) {
    if (!s) return '';
    s = s.trim();
    const m = s.match(cdataRe);
    return (m ? m[1] : s).trim();
  }
  let match;
  while ((match = itemRe.exec(xmlText)) !== null) {
    const block = match[0];
    const title = unwrap((titleRe.exec(block) || [])[1]);
    const link = unwrap((linkRe.exec(block) || [])[1]);
    const pubDate = unwrap((dateRe.exec(block) || [])[1]);
    if (title && link) {
      items.push({ title: title, link: link, pubDate: pubDate, kind: classifyNewsItem(link) });
    }
  }
  return items;
}

async function fetchNews() {
  const r = await fetch(MISES_FEED, { headers: { 'User-Agent': USER_AGENT } });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const xml = await r.text();
  return parseRssItems(xml).slice(0, 10);
}

(async function () {
  console.log('Fetching FRED indicators...');
  const indicators = {};
  let cpiPoints = null;
  let ok = 0, fail = 0;

  // Sequential — keeps load on FRED gentle and total runtime is still < 30s.
  for (const id of SERIES_IDS) {
    try {
      const points = await fetchFred(id);
      if (id === 'CPIAUCSL') cpiPoints = points;
      indicators[id] = summarize(points);
      ok += 1;
    } catch (err) {
      console.warn('  ' + id + ' failed: ' + err.message);
      indicators[id] = null;
      fail += 1;
    }
  }

  // Derived CPI YoY.
  if (cpiPoints) {
    const yoy = cpiYoY(cpiPoints);
    indicators.CPI_YOY = yoy ? { latest: yoy.latest, previous: null } : null;
  } else {
    indicators.CPI_YOY = null;
  }

  console.log('Fetching Mises feed...');
  let news = [];
  try {
    news = await fetchNews();
  } catch (err) {
    console.warn('  Mises feed failed: ' + err.message);
  }

  // Output JSON — data contract that economics.html consumes.
  const output = {
    fetchedAt: new Date().toISOString(),
    indicators: indicators,
    news: news
  };

  const outPath = path.join(__dirname, 'econ-data.json');
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2));

  console.log('Wrote ' + outPath);
  console.log('  Indicators: ' + ok + ' ok, ' + fail + ' failed (of ' + SERIES_IDS.length + ')');
  console.log('  News items: ' + news.length);
})().catch(function (err) {
  console.error('Error:', err.message);
  process.exit(1);
});
