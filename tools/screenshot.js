#!/usr/bin/env node
/*
 * tools/screenshot.js — local visual check, zero dependencies.
 *
 * Serves the repo root over HTTP (so the pages' fetch() of *-data.json works —
 * file:// does not) and drives the system Chrome/Edge in headless mode to:
 *   1. save a PNG to screenshots/check-<page>.png, and
 *   2. dump the rendered DOM and assert each dynamic page actually hydrated
 *      (catches a broken fetch/render path, not just a blank-looking picture).
 *
 * No npm install, no node_modules — uses Node stdlib + a browser you already
 * have. Run from anywhere:
 *     node tools/screenshot.js                # all pages
 *     node tools/screenshot.js bitcoin film   # just these
 * Override the browser with:  CHROME_PATH="C:\\path\\to\\msedge.exe" node tools/screenshot.js
 */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'screenshots');
const PORT = 8099;
const WINDOW = '1440,4000';          // tall viewport ≈ near-full-page for most pages
const SETTLE_MS = 6000;              // virtual-time budget: lets fetch()+render finish
const HARD_TIMEOUT_MS = 35000;       // wall-clock backstop so a stuck load can't hang

const MIME = {
  '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.ico': 'image/x-icon', '.txt': 'text/plain', '.xml': 'application/xml',
};

// Per-page hydration assertions. Pages not listed are screenshotted only.
const CHECKS = {
  seymour: { count: [['class="sy-photo-btn"', 30]] },
  'video-games': { must: ['data-hydrated="steam"'], mustNot: ['Data feed unavailable'] },
  film: { must: ['data-hydrated="film"'], mustNot: ['Data feed unavailable'] },
};

const ALL_PAGES = ['index', 'now', 'video-games', 'film', 'reading', 'seymour', '404'];

function findBrowser() {
  const candidates = [
    process.env.CHROME_PATH,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ].filter(Boolean);
  for (const c of candidates) { try { if (fs.statSync(c).isFile()) return c; } catch (e) {} }
  throw new Error('No Chrome/Edge found. Set CHROME_PATH.');
}

function startServer() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      let rel = decodeURIComponent(req.url.split('?')[0]);
      if (rel === '/') rel = '/index.html';
      const file = path.join(ROOT, path.normalize(rel));
      if (!file.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
      fs.readFile(file, (err, buf) => {
        if (err) { res.writeHead(404); return res.end('not found'); }
        res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream' });
        res.end(buf);
      });
    });
    server.listen(PORT, '127.0.0.1', () => resolve(server));
  });
}

const BASE_FLAGS = [
  // old headless reliably honors --virtual-time-budget for one-shot capture +
  // exit; --headless=new hangs in this combo on Chrome 12x.
  '--headless=old', '--disable-gpu', '--hide-scrollbars',
  '--no-first-run', '--no-default-browser-check',
  '--no-pings', '--disable-extensions', '--disable-sync',
  '--disable-background-networking', '--disable-component-update',
  '--disable-default-apps', '--metrics-recording-only', '--mute-audio',
  // Fail external hosts fast so a third-party tag (Google Analytics) can't
  // stall the virtual-time clock. Allow the Letterboxd poster CDN so the film
  // page still renders its art. (127.0.0.1 is an IP literal, so the local
  // server is never subject to host-resolution rules.)
  '--host-resolver-rules=MAP * ~NOTFOUND EXCLUDE localhost EXCLUDE a.ltrbxd.com',
  '--window-size=' + WINDOW,
  '--virtual-time-budget=' + SETTLE_MS,
];

// Launch Chrome once, ASYNCHRONOUSLY, so the in-process static server keeps
// serving the page while Chrome loads it. A synchronous launch would block the
// event loop, the server couldn't answer, the page would never load, and
// virtual-time would wait forever — the bug this tool originally had. stdout is
// routed to NUL or a file fd, never a pipe, so a lingering Chrome child can't
// hold us waiting on EOF.
function launch(browser, extraArgs, stdoutSpec) {
  return new Promise((resolve, reject) => {
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'shot-'));
    const cleanup = () => { try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) {} };
    let done = false;
    const finish = (fn, arg) => { if (done) return; done = true; clearTimeout(timer); cleanup(); fn(arg); };
    const child = spawn(browser, [...BASE_FLAGS, '--user-data-dir=' + profile, ...extraArgs],
      { stdio: ['ignore', stdoutSpec || 'ignore', 'ignore'] });
    const timer = setTimeout(() => {
      try { child.kill('SIGKILL'); } catch (e) {}
      finish(reject, new Error('timeout after ' + HARD_TIMEOUT_MS + 'ms'));
    }, HARD_TIMEOUT_MS);
    child.on('error', (e) => finish(reject, e));
    child.on('exit', () => finish(resolve));
  });
}

async function screenshot(browser, url, pngPath) {
  await launch(browser, ['--screenshot=' + pngPath, url], 'ignore');
}

async function renderedDom(browser, url) {
  const tmp = path.join(os.tmpdir(), 'dom-' + Math.random().toString(36).slice(2) + '.html');
  const fd = fs.openSync(tmp, 'w');
  try { await launch(browser, ['--dump-dom', url], fd); } finally { fs.closeSync(fd); }
  const html = fs.readFileSync(tmp, 'utf8');
  try { fs.rmSync(tmp, { force: true }); } catch (e) {}
  // Strip inline script/style source so assertions match RENDERED markup only —
  // otherwise a string literal inside the page's JS (e.g. an error message it
  // never displayed) would satisfy or trip a check it shouldn't.
  return html.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '');
}

(async function main() {
  const pages = process.argv.slice(2).length ? process.argv.slice(2) : ALL_PAGES;
  fs.mkdirSync(OUT, { recursive: true });
  const browser = findBrowser();
  console.log('Browser: ' + browser);
  const server = await startServer();
  console.log('Serving ' + ROOT + ' at http://127.0.0.1:' + PORT + '\n');

  let failures = 0;
  for (const page of pages) {
    const url = 'http://127.0.0.1:' + PORT + '/' + page + '.html';
    const png = path.join(OUT, 'check-' + page + '.png');
    try {
      await screenshot(browser, url, png);
      const size = fs.statSync(png).size;
      let note = 'screenshot ' + (size / 1024).toFixed(0) + 'KB';

      const chk = CHECKS[page];
      if (chk) {
        const dom = await renderedDom(browser, url);
        const problems = [];
        (chk.must || []).forEach(s => { if (!dom.includes(s)) problems.push('missing "' + s + '"'); });
        (chk.mustNot || []).forEach(s => { if (dom.includes(s)) problems.push('unexpected "' + s + '"'); });
        (chk.count || []).forEach(([s, n]) => {
          const got = dom.split(s).length - 1;
          if (got !== n) problems.push('"' + s + '" x' + got + ' (want ' + n + ')');
        });
        if (problems.length) { failures++; note += '  HYDRATION FAIL: ' + problems.join('; '); }
        else note += '  hydration OK';
      }
      console.log((chk && note.includes('FAIL') ? 'FAIL ' : 'ok   ') + page.padEnd(13) + ' ' + note);
    } catch (e) {
      failures++;
      console.log('FAIL ' + page.padEnd(13) + ' ' + e.message.split('\n')[0]);
    }
  }

  server.close();
  console.log('\n' + (failures ? failures + ' page(s) need attention' : 'All pages rendered + hydrated cleanly'));
  process.exit(failures ? 1 : 0);
})();
