#!/usr/bin/env node
/*
 * btc-fetch.js — Fetches Bitcoin price, 90-day history, recent blocks, and
 * headlines; writes btc-data.json. Runs via GitHub Actions (update-btc.yml)
 * or locally with `node btc-fetch.js`.
 *
 * No API key required: mempool.space (price + blocks), CryptoCompare
 * (history, with CoinGecko fallback), CoinDesk RSS (headlines). Every section
 * keeps the previously written JSON if its source fails, so a flaky API can
 * never blank the page.
 */

const fs = require('fs');
const path = require('path');

const USER_AGENT = 'ericarmbruster.com btc-fetch/1.0';
const OUT_PATH = path.join(__dirname, 'btc-data.json');

async function getJson(url) {
  const r = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
  if (!r.ok) throw new Error('HTTP ' + r.status + ' for ' + url);
  return r.json();
}

async function getText(url) {
  const r = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
  if (!r.ok) throw new Error('HTTP ' + r.status + ' for ' + url);
  return r.text();
}

/* Spot price — mempool.space, USD. */
async function fetchPrice() {
  const data = await getJson('https://mempool.space/api/v1/prices');
  if (!data || !Number.isFinite(data.USD)) throw new Error('bad price payload');
  return { usd: data.USD, time: data.time || null };
}

/* 90 daily closes — CoinGecko (keyless; one call per run keeps well under
 * its public rate limits). A failure keeps the previously baked series. */
async function fetchHistory() {
  const data = await getJson(
    'https://api.coingecko.com/api/v3/coins/bitcoin/market_chart?vs_currency=usd&days=90&interval=daily'
  );
  const points = ((data || {}).prices || []).map(function (p) {
    return { date: new Date(p[0]).toISOString().slice(0, 10), close: p[1] };
  });
  if (points.length < 30) throw new Error('too few points: ' + points.length);
  return points;
}

/* Recent blocks — mempool.space. */
async function fetchBlocks() {
  const data = await getJson('https://mempool.space/api/blocks');
  if (!Array.isArray(data) || !data.length) throw new Error('bad blocks payload');
  return data.slice(0, 8).map(function (b) {
    return { height: b.height, id: b.id, timestamp: b.timestamp, txCount: b.tx_count };
  });
}

/* Headlines — CoinDesk RSS (Node fetch follows the redirect). */
function tag(block, name) {
  const m = block.match(new RegExp('<' + name + '>([\\s\\S]*?)<\\/' + name + '>', 'i'));
  if (!m) return '';
  const s = m[1].trim();
  const cdata = s.match(/^<!\[CDATA\[([\s\S]*?)\]\]>$/);
  return (cdata ? cdata[1] : s).trim();
}

function decodeEntities(s) {
  return String(s || '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").trim();
}

async function fetchNews() {
  const xml = await getText('https://www.coindesk.com/arc/outboundfeeds/rss/');
  const items = [];
  const itemRe = /<item>[\s\S]*?<\/item>/gi;
  let m;
  while ((m = itemRe.exec(xml)) !== null && items.length < 12) {
    const block = m[0];
    const title = decodeEntities(tag(block, 'title'));
    const link = tag(block, 'link');
    const pubDate = tag(block, 'pubDate');
    if (title && link) items.push({ title: title, link: link, pubDate: pubDate });
  }
  if (!items.length) throw new Error('feed parsed to 0 items');
  return items;
}

(async function () {
  // Previous output — fallback when a section fails.
  let previous = {};
  try { previous = JSON.parse(fs.readFileSync(OUT_PATH, 'utf-8')); } catch (e) { /* first run */ }

  console.log('Fetching Bitcoin data...');
  const [priceR, historyR, blocksR, newsR] = await Promise.allSettled([
    fetchPrice(), fetchHistory(), fetchBlocks(), fetchNews()
  ]);

  function settle(result, label, fallback) {
    if (result.status === 'fulfilled') return result.value;
    console.warn('  ' + label + ' failed: ' + result.reason.message + ' (keeping previous)');
    return fallback;
  }

  const price = settle(priceR, 'Price', previous.price || null);
  const history = settle(historyR, 'History', previous.history90d || []);
  const blocks = settle(blocksR, 'Blocks', previous.blocks || []);
  const news = settle(newsR, 'News', previous.news || []);

  // 24h / 7d / 30d moves computed from the daily series + live spot.
  function pctFrom(daysAgo) {
    if (!price || !history.length) return null;
    const idx = history.length - 1 - daysAgo;
    if (idx < 0 || !history[idx]) return null;
    return ((price.usd / history[idx].close) - 1) * 100;
  }

  const output = {
    fetchedAt: new Date().toISOString(),
    price: price,
    moves: { d1: pctFrom(1), d7: pctFrom(7), d30: pctFrom(30) },
    history90d: history,
    blocks: blocks,
    news: news
  };

  fs.writeFileSync(OUT_PATH, JSON.stringify(output, null, 2));
  console.log('Wrote ' + OUT_PATH);
  console.log('  Price: $' + (price ? price.usd.toLocaleString('en-US') : 'n/a'));
  console.log('  History: ' + history.length + ' days · Blocks: ' + blocks.length + ' · News: ' + news.length);
})().catch(function (err) {
  console.error('Error:', err.message);
  process.exit(1);
});
