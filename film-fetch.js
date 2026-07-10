#!/usr/bin/env node
/*
 * film-fetch.js — Fetches the Letterboxd RSS feed + profile/lists pages,
 * writes film-data.json. Runs via GitHub Actions (update-film.yml) or locally
 * with `node film-fetch.js`.
 *
 * No API key required — the RSS feed is public and the profile pages are
 * fetched server-side, so the browser never needs CORS proxies. Letterboxd
 * HTML scraping is inherently fragile, so every section falls back to the
 * previously written JSON if a fetch or parse fails.
 */

const fs = require('fs');
const path = require('path');

const USERNAME = 'tenderbrew';
const BASE = 'https://letterboxd.com';
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

const OUT_PATH = path.join(__dirname, 'film-data.json');

async function get(url) {
  const r = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
  if (!r.ok) throw new Error('HTTP ' + r.status + ' for ' + url);
  return r.text();
}

function decodeEntities(s) {
  return String(s || '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&nbsp;/g, ' ')
    .trim();
}

function tag(block, name) {
  const m = block.match(new RegExp('<' + name + '>([\\s\\S]*?)<\\/' + name + '>', 'i'));
  if (!m) return '';
  const s = m[1].trim();
  const cdata = s.match(/^<!\[CDATA\[([\s\S]*?)\]\]>$/);
  return (cdata ? cdata[1] : s).trim();
}

/* RSS — diary entries (watches/reviews). List items in the feed are skipped;
 * lists come from the lists page scrape below. */
function parseFeed(xml) {
  const recent = [];
  const itemRe = /<item>[\s\S]*?<\/item>/gi;
  let m;
  while ((m = itemRe.exec(xml)) !== null) {
    const block = m[0];
    const link = tag(block, 'link');
    if (!/\/film\//.test(link)) continue; // skip list/story items
    const description = tag(block, 'description');
    const posterM = description.match(/<img src="([^"]+)"/);
    // Review text: paragraphs after the poster image, minus the boilerplate
    // "Watched on ..." line Letterboxd appends to review-less entries.
    const paras = [];
    const pRe = /<p>([\s\S]*?)<\/p>/g;
    let pm;
    while ((pm = pRe.exec(description)) !== null) {
      const text = decodeEntities(pm[1].replace(/<[^>]+>/g, ''));
      if (text && !/^Watched on /.test(text)) paras.push(text);
    }
    const ratingStr = tag(block, 'letterboxd:memberRating');
    recent.push({
      title: decodeEntities(tag(block, 'letterboxd:filmTitle')),
      year: tag(block, 'letterboxd:filmYear'),
      rating: ratingStr ? Number(ratingStr) : null,
      watchedDate: tag(block, 'letterboxd:watchedDate'),
      rewatch: tag(block, 'letterboxd:rewatch') === 'Yes',
      link: link,
      poster: posterM ? posterM[1] : '',
      review: paras.join(' ')
    });
  }
  return recent.slice(0, 12);
}

/* Profile page — the five header statistics + the four favorite films. */
function parseProfile(html) {
  function stat(href) {
    const re = new RegExp('href="/' + USERNAME + '/' + href + '/?"[^>]*><span class="value">([\\d,]+)');
    const m = html.match(re);
    return m ? Number(m[1].replace(/,/g, '')) : null;
  }
  const stats = {
    films: stat('films'),
    thisYear: stat('diary/for/\\d+'),
    lists: stat('lists'),
    following: stat('following'),
    followers: stat('followers')
  };

  const favorites = [];
  const favSection = html.match(/id="favourites"[\s\S]*?<\/section>/i);
  if (favSection) {
    const favRe = /data-item-link="([^"]+)"[^>]*data-item-full-display-name="([^"]+)"/g;
    let fm;
    while ((fm = favRe.exec(favSection[0])) !== null && favorites.length < 4) {
      const name = decodeEntities(fm[2]);
      if (!favorites.some(function (f) { return f.title === name; })) {
        favorites.push({ title: name, link: BASE + fm[1] });
      }
    }
  }
  return { stats: stats, favorites: favorites };
}

/* Lists page — one entry per list-summary article. */
function parseLists(html) {
  const lists = [];
  const artRe = /<article class="list-summary[\s\S]*?<\/article>/gi;
  let m;
  while ((m = artRe.exec(html)) !== null) {
    const block = m[0];
    const linkM = block.match(new RegExp('href="(/' + USERNAME + '/list/[^"]+/)"'));
    if (!linkM || /\/(edit|likes)\/$/.test(linkM[1])) continue;
    // The display title lives in <h2 class="name prettify"><a href>TITLE</a>.
    const titleM = block.match(/<h2 class="name[^"]*">\s*<a [^>]*>([\s\S]*?)<\/a>/);
    const countM = block.match(/([\d,]+)(?:&nbsp;|\s)films?/i);
    let title = '';
    if (titleM) title = decodeEntities(titleM[1].replace(/<[^>]+>/g, ''));
    if (!title) {
      // Fall back to the slug, de-kebabed.
      title = linkM[1].split('/').filter(Boolean).pop().replace(/-/g, ' ');
    }
    lists.push({
      title: title,
      link: BASE + linkM[1],
      films: countM ? Number(countM[1].replace(/,/g, '')) : null
    });
  }
  return lists;
}

(async function () {
  // Previous output — fallback when a section fails.
  let previous = {};
  try { previous = JSON.parse(fs.readFileSync(OUT_PATH, 'utf-8')); } catch (e) { /* first run */ }

  console.log('Fetching Letterboxd data for ' + USERNAME + '...');
  let recent = null, profile = null, lists = null;

  try {
    recent = parseFeed(await get(BASE + '/' + USERNAME + '/rss/'));
    if (!recent.length) throw new Error('feed parsed to 0 items');
  } catch (err) {
    console.warn('  RSS failed: ' + err.message + ' (keeping previous)');
    recent = previous.recent || [];
  }

  try {
    profile = parseProfile(await get(BASE + '/' + USERNAME + '/'));
    if (profile.stats.films == null) throw new Error('stats parsed to null');
    if (!profile.favorites.length) console.warn('  favorites parsed to 0 (page layout change?)');
  } catch (err) {
    console.warn('  Profile failed: ' + err.message + ' (keeping previous)');
    profile = { stats: previous.stats || {}, favorites: previous.favorites || [] };
  }

  try {
    lists = parseLists(await get(BASE + '/' + USERNAME + '/lists/'));
    if (!lists.length) throw new Error('lists parsed to 0 items');
  } catch (err) {
    console.warn('  Lists failed: ' + err.message + ' (keeping previous)');
    lists = previous.lists || [];
  }

  const output = {
    fetchedAt: new Date().toISOString(),
    profileUrl: BASE + '/' + USERNAME + '/',
    stats: profile.stats,
    favorites: profile.favorites,
    recent: recent,
    lists: lists
  };

  fs.writeFileSync(OUT_PATH, JSON.stringify(output, null, 2));
  console.log('Wrote ' + OUT_PATH);
  console.log('  Films: ' + output.stats.films + ' (' + output.stats.thisYear + ' this year)');
  console.log('  Favorites: ' + output.favorites.map(function (f) { return f.title; }).join('; '));
  console.log('  Recent: ' + output.recent.length + ' · Lists: ' + output.lists.length);
})().catch(function (err) {
  console.error('Error:', err.message);
  process.exit(1);
});
