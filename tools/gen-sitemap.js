#!/usr/bin/env node
/*
 * tools/gen-sitemap.js — regenerates sitemap.xml from the pages on disk.
 *
 * Enumerates root *.html, drops the noindex set (birds, colophon, 404),
 * maps index.html to the bare host, and stamps <lastmod> from each file's
 * last git commit date. Run by .github/workflows/gen-sitemap.yml on any
 * push that touches a page; safe to run locally too:
 *     node tools/gen-sitemap.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const HOST = 'https://www.ericarmbruster.com';
const NOINDEX = new Set(['birds.html', 'colophon.html', '404.html']);

const pages = fs.readdirSync(ROOT)
  .filter((f) => f.endsWith('.html') && !f.startsWith('_') && !NOINDEX.has(f))
  .sort((a, b) => (a === 'index.html' ? -1 : b === 'index.html' ? 1 : a.localeCompare(b)));

function lastmod(file) {
  try {
    const out = execSync('git log -1 --format=%cs -- "' + file + '"', { cwd: ROOT }).toString().trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(out)) return out;
  } catch (e) { /* fall through */ }
  return new Date().toISOString().slice(0, 10);
}

const urls = pages.map((f) => {
  const loc = f === 'index.html' ? HOST + '/' : HOST + '/' + f;
  return '  <url>\n    <loc>' + loc + '</loc>\n    <lastmod>' + lastmod(f) + '</lastmod>\n  </url>';
});

const xml = '<?xml version="1.0" encoding="UTF-8"?>\n' +
  '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
  urls.join('\n') + '\n</urlset>\n';

const outPath = path.join(ROOT, 'sitemap.xml');
const prev = fs.existsSync(outPath) ? fs.readFileSync(outPath, 'utf-8') : '';
if (prev === xml) {
  console.log('sitemap.xml unchanged (' + pages.length + ' pages)');
} else {
  fs.writeFileSync(outPath, xml);
  console.log('sitemap.xml regenerated: ' + pages.length + ' pages');
}
