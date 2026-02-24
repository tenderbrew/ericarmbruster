/*
 * ticker.js — Shared scrolling ticker tape for live market data
 * ==============================================================
 * Loaded on every page. Populates the scrolling ticker bar at the top of the
 * site with live financial data from three sources:
 *   - FRED (Federal Reserve Economic Data) — S&P 500, NASDAQ, 10Y yield,
 *     gold, VIX, EUR/USD, crude oil, fed funds rate
 *   - CoinGecko — Bitcoin price and 24h change
 *   - Yahoo Finance — Dow Jones Industrial Average
 *
 * Each ticker item in the HTML has a `data-ticker="SYMBOL"` attribute that
 * this script targets to inject the live value and color (green up, red down).
 *
 * The FRED and Yahoo Finance APIs don't support browser CORS requests, so
 * this script routes them through free CORS proxy services. If one proxy
 * fails, it falls back to the next — a resilience pattern called a
 * "fallback chain."
 *
 * Wrapped in an IIFE to keep all variables private to this script.
 */
(function () {
  'use strict';

  /* ══════════════════════════════════════════════════════════════════════
   * CORS PROXY FALLBACK CHAIN
   * ══════════════════════════════════════════════════════════════════════
   * Browsers block cross-origin requests unless the target server sends
   * CORS headers. FRED and Yahoo don't send these, so we relay requests
   * through free proxy services that add the necessary headers.
   *
   * Three proxies are tried in order:
   *   1. Codetabs — fast, returns raw text directly
   *   2. AllOrigins /get — returns JSON wrapper with a `contents` field
   *   3. AllOrigins /raw — returns raw text like Codetabs
   *
   * If proxy 1 is down, proxy 2 is tried; if that fails, proxy 3 is the
   * last resort. If all three fail, that ticker item simply stays at its
   * placeholder text (graceful degradation).
   */

  /* AllOrigins /get sometimes returns the response body as a data URI
   * (e.g., "data:text/csv;base64,SGVsbG8="). This function detects that
   * format and decodes it back to plain text. If the content is already
   * plain text, it passes through unchanged. */
  function decodeDataPayload(contents) {
    if (!contents) return '';
    /* Check if the string starts with the "data:" URI scheme prefix. */
    if (contents.indexOf('data:') !== 0) return contents;
    /* Split at the first comma — everything before is metadata (MIME type,
     * encoding), everything after is the actual payload. */
    var comma = contents.indexOf(',');
    if (comma === -1) return contents;
    var metadata = contents.slice(0, comma);
    var payload = contents.slice(comma + 1);
    /* If the metadata says base64, decode it with atob(). Otherwise, it's
     * percent-encoded (like a URL), so decodeURIComponent() handles it. */
    if (metadata.indexOf(';base64') !== -1) return atob(payload);
    return decodeURIComponent(payload);
  }

  /* Proxy 1: Codetabs — simplest proxy, takes a `quest` parameter and
   * returns the target URL's response body as plain text.
   * `cache: 'no-store'` prevents the browser from serving a stale cached
   * response — we always want fresh market data. */
  async function fetchViaCodetabs(url) {
    var r = await fetch('https://api.codetabs.com/v1/proxy/?quest=' + encodeURIComponent(url), { cache: 'no-store' });
    if (!r.ok) throw new Error('Codetabs HTTP ' + r.status);
    return r.text();
  }

  /* Proxy 2: AllOrigins /get endpoint — returns a JSON object with a
   * `contents` field holding the target URL's response body. The body
   * might be a data URI (especially for binary-ish content), hence
   * the decodeDataPayload() call. */
  async function fetchViaAllOriginsGet(url) {
    var r = await fetch('https://api.allorigins.win/get?url=' + encodeURIComponent(url), { cache: 'no-store' });
    if (!r.ok) throw new Error('AllOrigins/get HTTP ' + r.status);
    var p = await r.json();
    var d = decodeDataPayload(p.contents || '');
    if (!d) throw new Error('AllOrigins/get empty');
    return d;
  }

  /* Proxy 3: AllOrigins /raw endpoint — returns the target URL's response
   * body directly as text (no JSON wrapper). Last resort in the chain. */
  async function fetchViaAllOriginsRaw(url) {
    var r = await fetch('https://api.allorigins.win/raw?url=' + encodeURIComponent(url), { cache: 'no-store' });
    if (!r.ok) throw new Error('AllOrigins/raw HTTP ' + r.status);
    return r.text();
  }

  /* Master fetch function — tries each proxy in sequence. If Codetabs
   * succeeds, the result is returned immediately. If it throws, the catch
   * block tries AllOrigins/get, and if that also throws, AllOrigins/raw
   * is the final attempt (its rejection will propagate to the caller). */
  async function fetchText(url) {
    try { return await fetchViaCodetabs(url); }
    catch (_) {
      try { return await fetchViaAllOriginsGet(url); }
      catch (__) { return fetchViaAllOriginsRaw(url); }
    }
  }

  /* ══════════════════════════════════════════════════════════════════════
   * FRED DATA HELPERS
   * ══════════════════════════════════════════════════════════════════════
   * FRED provides economic data as CSV files (one row per date). These
   * helpers parse the CSV and extract the most recent values.
   */

  /* Parses a FRED CSV string into an array of {date, value} objects.
   * FRED CSVs have a header row ("DATE,VALUE") followed by data rows
   * like "2024-01-15,4783.83". Rows with non-numeric values (like "."
   * which FRED uses for missing data) are filtered out. */
  function parseFredCsv(csv) {
    var lines = csv.split(/\r?\n/).filter(Boolean);
    if (lines.length < 2) return [];
    /* Skip the header row (index 0), process all data rows. */
    return lines.slice(1).map(function (line) {
      var parts = line.split(',');
      if (parts.length < 2) return null;
      var v = Number(parts[1]);
      /* Number.isFinite() rejects NaN and Infinity, catching FRED's
       * "." placeholder for missing/unavailable data points. */
      return Number.isFinite(v) ? { date: parts[0], value: v } : null;
    }).filter(Boolean);
  }

  /* Fetches a single FRED data series by its ID (e.g., "SP500", "DGS10").
   * The fredgraph.csv endpoint returns the full history as CSV. We parse
   * it and require at least one valid data point. */
  async function fetchFred(id) {
    var url = 'https://fred.stlouisfed.org/graph/fredgraph.csv?id=' + encodeURIComponent(id);
    var csv = await fetchText(url);
    var pts = parseFredCsv(csv);
    if (!pts.length) throw new Error('No data');
    return pts;
  }

  /* Extracts the last two data points from a FRED series. The latest
   * value is displayed in the ticker; the previous value is used to
   * calculate the percent change (delta). */
  function latestPair(pts) {
    if (!pts.length) return { latest: null, previous: null };
    return {
      latest: pts[pts.length - 1],
      previous: pts.length > 1 ? pts[pts.length - 2] : null
    };
  }

  /* ══════════════════════════════════════════════════════════════════════
   * TICKER CONFIGURATION
   * ══════════════════════════════════════════════════════════════════════
   * Each object defines one FRED-sourced ticker item:
   *   attr     — matches the data-ticker="..." attribute in the HTML
   *   fred     — the FRED series ID to fetch
   *   label    — display name shown before the number
   *   decimals — how many decimal places to show
   *   suffix   — optional string appended after the number (e.g., "%")
   */
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

  /* ══════════════════════════════════════════════════════════════════════
   * DOM UPDATE HELPERS
   * ══════════════════════════════════════════════════════════════════════
   */

  /* Finds all <span> elements with a matching data-ticker attribute and
   * updates their text content and CSS class. The ticker tape HTML has
   * duplicate spans (the tape is doubled for seamless CSS scroll animation),
   * so this updates ALL matching spans at once.
   * `direction` is "up", "down", or null — it controls the green/red
   * color class applied to the span. */
  function updateSpans(attr, text, direction) {
    var spans = document.querySelectorAll('[data-ticker="' + attr + '"]');
    for (var i = 0; i < spans.length; i++) {
      spans[i].textContent = text;
      /* Remove both directional classes first, then add the correct one.
       * This prevents stale colors from a previous update. */
      spans[i].classList.remove('tick--up', 'tick--down');
      if (direction === 'up') spans[i].classList.add('tick--up');
      if (direction === 'down') spans[i].classList.add('tick--down');
    }
  }

  /* Formats a ticker string like "S&P 500 4,783 ▲0.45%".
   * `toLocaleString` adds thousand separators (commas).
   * The triangle arrows (▲/▼) are Unicode characters that serve as
   * visual direction indicators alongside the green/red coloring. */
  function fmtTicker(label, value, decimals, suffix, pct) {
    var f = value.toLocaleString(undefined, {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals
    });
    var t = label + ' ' + f;
    if (suffix) t += suffix;
    if (pct !== null && Number.isFinite(pct)) {
      /* \u25B2 = ▲ (up triangle), \u25BC = ▼ (down triangle) */
      t += ' ' + (pct >= 0 ? '\u25B2' : '\u25BC') + Math.abs(pct).toFixed(2) + '%';
    }
    return t;
  }

  /* ══════════════════════════════════════════════════════════════════════
   * MAIN DATA LOADER
   * ══════════════════════════════════════════════════════════════════════
   * Fetches all ticker data sources and updates the DOM.
   */
  async function loadTicker() {

    /* ── FRED tickers ────────────────────────────────────────────────
     * `Promise.allSettled` fires all FRED requests in parallel and waits
     * for ALL of them to finish — unlike `Promise.all`, it does NOT abort
     * if one fails. This means a single failed series (e.g., VIX is
     * unavailable) won't prevent the other 7 from displaying. */
    var results = await Promise.allSettled(fredTickers.map(function (cfg) {
      return fetchFred(cfg.fred).then(function (pts) { return { cfg: cfg, pts: pts }; });
    }));

    /* Process each settled result. Rejected promises (failed fetches) are
     * simply skipped — their ticker spans keep their placeholder text. */
    results.forEach(function (r) {
      if (r.status !== 'fulfilled') return;
      var cfg = r.value.cfg;
      var pair = latestPair(r.value.pts);
      if (!pair.latest) return;
      var val = pair.latest.value;
      /* Calculate percent change from the previous data point. If there's
       * no previous point (new series), pct stays null and no arrow shows. */
      var pct = pair.previous ? ((val - pair.previous.value) / Math.abs(pair.previous.value)) * 100 : null;
      updateSpans(cfg.attr, fmtTicker(cfg.label, val, cfg.decimals, cfg.suffix, pct), pct === null ? null : (pct >= 0 ? 'up' : 'down'));
    });

    /* ── Bitcoin via CoinGecko ───────────────────────────────────────
     * CoinGecko's free API supports CORS natively, so no proxy is needed.
     * We request the USD price and the 24-hour percent change in a single
     * call. The `try/catch` ensures that if CoinGecko is down, the rest
     * of the ticker still works. */
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

    /* ── Dow Jones via Yahoo Finance ─────────────────────────────────
     * Yahoo's chart API returns JSON with price data. The `^DJI` symbol
     * (URL-encoded as %5EDJI) is the Dow Jones Industrial Average.
     * `range=2d&interval=1d` gives us today's price and yesterday's
     * close, which we use to compute the daily percent change.
     * This endpoint requires a CORS proxy (no browser CORS headers). */
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

  /* ══════════════════════════════════════════════════════════════════════
   * INITIALIZATION
   * ══════════════════════════════════════════════════════════════════════
   * Only runs if the page has a ticker tape element. This guard prevents
   * errors on pages where the ticker HTML might not be present. */
  if (document.querySelector('.ticker-tape')) {
    loadTicker();
  }
})();
