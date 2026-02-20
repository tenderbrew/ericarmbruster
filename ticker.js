/*
  ticker.js
  Shared scrolling ticker tape — live market data from FRED, CoinGecko, Yahoo Finance.
  Included on every page. Falls back gracefully to static placeholder text.
*/
(function () {
  'use strict';

  // ── CORS proxy fallback chain ──────────────────────────────────────

  function decodeDataPayload(contents) {
    if (!contents) return '';
    if (contents.indexOf('data:') !== 0) return contents;
    var comma = contents.indexOf(',');
    if (comma === -1) return contents;
    var metadata = contents.slice(0, comma);
    var payload = contents.slice(comma + 1);
    if (metadata.indexOf(';base64') !== -1) return atob(payload);
    return decodeURIComponent(payload);
  }

  async function fetchViaCodetabs(url) {
    var r = await fetch('https://api.codetabs.com/v1/proxy/?quest=' + encodeURIComponent(url), { cache: 'no-store' });
    if (!r.ok) throw new Error('Codetabs HTTP ' + r.status);
    return r.text();
  }

  async function fetchViaAllOriginsGet(url) {
    var r = await fetch('https://api.allorigins.win/get?url=' + encodeURIComponent(url), { cache: 'no-store' });
    if (!r.ok) throw new Error('AllOrigins/get HTTP ' + r.status);
    var p = await r.json();
    var d = decodeDataPayload(p.contents || '');
    if (!d) throw new Error('AllOrigins/get empty');
    return d;
  }

  async function fetchViaAllOriginsRaw(url) {
    var r = await fetch('https://api.allorigins.win/raw?url=' + encodeURIComponent(url), { cache: 'no-store' });
    if (!r.ok) throw new Error('AllOrigins/raw HTTP ' + r.status);
    return r.text();
  }

  async function fetchText(url) {
    try { return await fetchViaCodetabs(url); }
    catch (_) {
      try { return await fetchViaAllOriginsGet(url); }
      catch (__) { return fetchViaAllOriginsRaw(url); }
    }
  }

  // ── FRED helpers ───────────────────────────────────────────────────

  function parseFredCsv(csv) {
    var lines = csv.split(/\r?\n/).filter(Boolean);
    if (lines.length < 2) return [];
    return lines.slice(1).map(function (line) {
      var parts = line.split(',');
      if (parts.length < 2) return null;
      var v = Number(parts[1]);
      return Number.isFinite(v) ? { date: parts[0], value: v } : null;
    }).filter(Boolean);
  }

  async function fetchFred(id) {
    var url = 'https://fred.stlouisfed.org/graph/fredgraph.csv?id=' + encodeURIComponent(id);
    var csv = await fetchText(url);
    var pts = parseFredCsv(csv);
    if (!pts.length) throw new Error('No data');
    return pts;
  }

  function latestPair(pts) {
    if (!pts.length) return { latest: null, previous: null };
    return {
      latest: pts[pts.length - 1],
      previous: pts.length > 1 ? pts[pts.length - 2] : null
    };
  }

  // ── Ticker config ──────────────────────────────────────────────────

  var fredTickers = [
    { attr: 'SP500',    fred: 'SP500',            label: 'S&P 500',   decimals: 0 },
    { attr: 'NASDAQ',   fred: 'NASDAQCOM',        label: 'NASDAQ',    decimals: 0 },
    { attr: '10Y',      fred: 'DGS10',            label: '10Y YIELD', decimals: 3, suffix: '%' },
    { attr: 'GOLD',     fred: 'GOLDAMGBD228NLBM', label: 'GOLD',      decimals: 2 },
    { attr: 'VIX',      fred: 'VIXCLS',           label: 'VIX',       decimals: 2 },
    { attr: 'EURUSD',   fred: 'DEXUSEU',          label: 'EUR/USD',   decimals: 4 },
    { attr: 'CRUDE',    fred: 'DCOILWTICO',       label: 'WTI CRUDE', decimals: 2 },
    { attr: 'FEDFUNDS', fred: 'FEDFUNDS',         label: 'FED FUNDS', decimals: 2, suffix: '%' }
  ];

  // ── DOM helpers ────────────────────────────────────────────────────

  function updateSpans(attr, text, direction) {
    var spans = document.querySelectorAll('[data-ticker="' + attr + '"]');
    for (var i = 0; i < spans.length; i++) {
      spans[i].textContent = text;
      spans[i].classList.remove('tick--up', 'tick--down');
      if (direction === 'up') spans[i].classList.add('tick--up');
      if (direction === 'down') spans[i].classList.add('tick--down');
    }
  }

  function fmtTicker(label, value, decimals, suffix, pct) {
    var f = value.toLocaleString(undefined, {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals
    });
    var t = label + ' ' + f;
    if (suffix) t += suffix;
    if (pct !== null && Number.isFinite(pct)) {
      t += ' ' + (pct >= 0 ? '\u25B2' : '\u25BC') + Math.abs(pct).toFixed(2) + '%';
    }
    return t;
  }

  // ── Load live data ─────────────────────────────────────────────────

  async function loadTicker() {
    // FRED tickers
    var results = await Promise.allSettled(fredTickers.map(function (cfg) {
      return fetchFred(cfg.fred).then(function (pts) { return { cfg: cfg, pts: pts }; });
    }));

    results.forEach(function (r) {
      if (r.status !== 'fulfilled') return;
      var cfg = r.value.cfg;
      var pair = latestPair(r.value.pts);
      if (!pair.latest) return;
      var val = pair.latest.value;
      var pct = pair.previous ? ((val - pair.previous.value) / Math.abs(pair.previous.value)) * 100 : null;
      updateSpans(cfg.attr, fmtTicker(cfg.label, val, cfg.decimals, cfg.suffix, pct), pct === null ? null : (pct >= 0 ? 'up' : 'down'));
    });

    // BTC via CoinGecko
    try {
      var resp = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd&include_24hr_change=true');
      if (resp.ok) {
        var d = await resp.json();
        var price = d.bitcoin.usd;
        var chg = d.bitcoin.usd_24h_change;
        var arrow = chg >= 0 ? '\u25B2' : '\u25BC';
        updateSpans('BTC', 'BTC ' + price.toLocaleString(undefined, { maximumFractionDigits: 0 }) + ' ' + arrow + Math.abs(chg).toFixed(2) + '%', chg >= 0 ? 'up' : 'down');
      }
    } catch (_) {}

    // DJIA via Yahoo Finance
    try {
      var raw = await fetchText('https://query1.finance.yahoo.com/v8/finance/chart/%5EDJI?range=2d&interval=1d');
      var data = JSON.parse(raw);
      var res = data.chart.result[0];
      var p = res.meta.regularMarketPrice;
      var prev = res.meta.chartPreviousClose || res.meta.previousClose;
      var pct2 = prev ? ((p - prev) / prev) * 100 : null;
      updateSpans('DJIA', fmtTicker('DJIA', p, 0, null, pct2), pct2 === null ? null : (pct2 >= 0 ? 'up' : 'down'));
    } catch (_) {}
  }

  // ── Init ───────────────────────────────────────────────────────────

  if (document.querySelector('.ticker-tape')) {
    loadTicker();
  }
})();
