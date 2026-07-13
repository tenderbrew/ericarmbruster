#!/usr/bin/env node
/*
 * reading-fetch.js — Fetches the Goodreads shelf RSS feed, writes
 * reading-data.json. Runs via GitHub Actions (update-reading.yml) or
 * locally with `node reading-fetch.js`.
 *
 * No API key required — Goodreads killed their API but public profiles
 * expose per-user RSS at /review/list_rss/<id> (all shelves, newest
 * first). If the fetch or parse fails, the previously written JSON is
 * left in place.
 */

const fs = require('fs');
const path = require('path');

const USER_ID = '22369018';
const FEED = 'https://www.goodreads.com/review/list_rss/' + USER_ID;
const PROFILE = 'https://www.goodreads.com/user/show/' + USER_ID + '-eric-armbruster';
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

const OUT_PATH = path.join(__dirname, 'reading-data.json');

function decodeEntities(s) {
  return String(s || '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&nbsp;/g, ' ')
    .trim();
}

function tag(block, name) {
  const m = block.match(new RegExp('<' + name + '(?:\\s[^>]*)?>([\\s\\S]*?)<\\/' + name + '>', 'i'));
  if (!m) return '';
  const s = m[1].trim();
  const cdata = s.match(/^<!\[CDATA\[([\s\S]*?)\]\]>$/);
  return (cdata ? cdata[1] : s).trim();
}

function isoDate(rssDate) {
  if (!rssDate) return null;
  const d = new Date(rssDate);
  return isNaN(d) ? null : d.toISOString().slice(0, 10);
}

function parseFeed(xml) {
  const books = [];
  const itemRe = /<item>[\s\S]*?<\/item>/gi;
  let m;
  while ((m = itemRe.exec(xml)) !== null) {
    const block = m[0];
    // user_shelves is empty for plain "read" entries.
    const shelvesRaw = tag(block, 'user_shelves');
    const shelf = shelvesRaw === '' ? 'read' : shelvesRaw.split(',')[0].trim();
    books.push({
      title: decodeEntities(tag(block, 'title')),
      author: decodeEntities(tag(block, 'author_name')),
      link: tag(block, 'link').replace(/\?utm.*$/, ''),
      cover: tag(block, 'book_large_image_url') || tag(block, 'book_medium_image_url') || null,
      rating: Number(tag(block, 'user_rating')) || 0,
      readAt: isoDate(tag(block, 'user_read_at')),
      addedAt: isoDate(tag(block, 'user_date_added')),
      shelf: shelf,
    });
  }
  return books;
}

async function main() {
  const r = await fetch(FEED, { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw new Error('HTTP ' + r.status + ' for ' + FEED);
  const xml = await r.text();

  const books = parseFeed(xml);
  if (!books.length) throw new Error('Parsed 0 items from the shelf feed — refusing to overwrite');

  const read = books
    .filter((b) => b.shelf === 'read')
    .sort((a, b) => String(b.readAt || b.addedAt || '').localeCompare(String(a.readAt || a.addedAt || '')));

  const data = {
    fetchedAt: new Date().toISOString(),
    profileUrl: PROFILE,
    currentlyReading: books.filter((b) => b.shelf === 'currently-reading'),
    read: read,
    toRead: books.filter((b) => b.shelf === 'to-read'),
  };

  // Skip the write (and the bot commit) when nothing but the timestamp
  // moved - keeps "Updated <time>" honest and kills no-op commits.
  try {
    var prevRaw = JSON.parse(fs.readFileSync(OUT_PATH, 'utf-8'));
    var stripStamp = function (o) { return JSON.stringify(Object.assign({}, o, { fetchedAt: null })); };
    if (stripStamp(prevRaw) === stripStamp(data)) {
      console.log('No data change - keeping previous file untouched.');
      return;
    }
  } catch (e) { /* first run */ }

  fs.writeFileSync(OUT_PATH, JSON.stringify(data, null, 2) + '\n');
  console.log('Wrote ' + OUT_PATH);
  console.log('  Currently reading: ' + data.currentlyReading.map((b) => b.title).join('; '));
  console.log('  Read: ' + data.read.length + ' · To read: ' + data.toRead.length);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
