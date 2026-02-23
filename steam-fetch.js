#!/usr/bin/env node
/*
 * steam-fetch.js — Build-time Steam Web API data fetcher
 * =======================================================
 * This is a Node.js script (NOT browser code). It runs either:
 *   - Automatically via GitHub Actions (see .github/workflows/update-steam.yml)
 *   - Manually on your machine with `node steam-fetch.js`
 *
 * What it does:
 *   1. Reads Steam API credentials from environment variables (or a local .env file)
 *   2. Makes three parallel requests to the Steam Web API
 *   3. Aggregates the data into a single stats object
 *   4. Writes the result to steam-data.json
 *
 * The website's video-games.html page then fetches steam-data.json at runtime
 * to display library stats, recently played games, and top-10 by playtime.
 * This two-step approach keeps the API key server-side (never exposed to browsers).
 *
 * The shebang line (#!/usr/bin/env node) allows running this directly as
 * `./steam-fetch.js` on Unix systems without prefixing `node`.
 */

/* Node built-in modules:
 * - `fs` for reading the .env file and writing the output JSON
 * - `path` for resolving file paths relative to this script's directory */
const fs = require('fs');
const path = require('path');

/* ── .env file loader ──────────────────────────────────────────────────
 * When running locally (not in GitHub Actions), credentials live in a .env
 * file in the project root. This block manually parses that file — it reads
 * each line, matches the `KEY=VALUE` pattern with a regex, and injects the
 * pair into `process.env`. This avoids needing the `dotenv` npm package.
 * In CI (GitHub Actions), the workflow injects these as environment variables
 * directly, so the .env file doesn't exist and this block is skipped.
 */
const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
  fs.readFileSync(envPath, 'utf-8').split('\n').forEach(function (line) {
    /* Regex breakdown: ^\s*([\w]+)\s*=\s*(.+?)\s*$
     *   ^\s*       — optional leading whitespace
     *   ([\w]+)    — capture group 1: the key name (letters, digits, underscores)
     *   \s*=\s*    — equals sign with optional surrounding whitespace
     *   (.+?)      — capture group 2: the value (non-greedy to trim trailing space)
     *   \s*$       — optional trailing whitespace */
    const match = line.match(/^\s*([\w]+)\s*=\s*(.+?)\s*$/);
    if (match) process.env[match[1]] = match[2];
  });
}

/* Read credentials from the environment. These are required — without them
 * the Steam API won't authenticate our requests. */
const API_KEY = process.env.STEAM_API_KEY;
const STEAM_ID = process.env.STEAM_ID;

/* Exit with an error if either credential is missing. `process.exit(1)` sets
 * a non-zero exit code, which tells GitHub Actions (or any CI) that the step
 * failed and should be flagged in the workflow run. */
if (!API_KEY || !STEAM_ID) {
  console.error('Missing STEAM_API_KEY or STEAM_ID in .env');
  process.exit(1);
}

/* Base URL for all Steam Web API endpoints. Every Steam API call follows the
 * pattern: https://api.steampowered.com/{interface}/{method}/v{version}/ */
const BASE = 'https://api.steampowered.com';


/* ── Generic Steam API helper ──────────────────────────────────────────
 * Builds a Steam API URL from its component parts and performs the HTTP
 * request. All three endpoint-specific functions below delegate to this.
 *
 * Parameters:
 *   iface   — the API interface (e.g., "IPlayerService", "ISteamUser")
 *   method  — the method name (e.g., "GetOwnedGames")
 *   version — the API version string (e.g., "0001")
 *   params  — additional query parameters specific to this endpoint
 *
 * `URLSearchParams` constructs the query string, automatically encoding
 * special characters. The spread `...params` merges endpoint-specific
 * parameters with the always-required key, steamid, and format. */
async function steamGet(iface, method, version, params) {
  const qs = new URLSearchParams({ key: API_KEY, steamid: STEAM_ID, format: 'json', ...params });
  const url = `${BASE}/${iface}/${method}/v${version}/?${qs}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${method} failed: ${res.status}`);
  return res.json();
}


/* ── Endpoint: GetOwnedGames ───────────────────────────────────────────
 * Returns the user's complete Steam library — every game they own, along
 * with metadata (name, icon) and total playtime in minutes.
 * `include_appinfo: '1'` adds game names and icons (otherwise you only
 * get numeric app IDs).
 * `include_played_free_games: '1'` includes free-to-play titles that
 * have been launched at least once. */
async function getOwnedGames() {
  const data = await steamGet('IPlayerService', 'GetOwnedGames', '0001', {
    include_appinfo: '1',
    include_played_free_games: '1'
  });
  return data.response;
}


/* ── Endpoint: GetRecentlyPlayedGames ──────────────────────────────────
 * Returns games played in the last two weeks, with both the two-week
 * playtime and the lifetime playtime. Limited to 10 results — this is
 * used for the "Recently Played" list on the video games page. */
async function getRecentlyPlayed() {
  const data = await steamGet('IPlayerService', 'GetRecentlyPlayedGames', '0001', {
    count: '10'
  });
  return data.response;
}


/* ── Endpoint: GetPlayerSummaries ──────────────────────────────────────
 * Returns public profile information: display name, avatar image URL,
 * and profile page URL. This uses a different interface (ISteamUser) and
 * a slightly different parameter name (steamids, plural), so it builds
 * its own URL rather than using the generic steamGet() helper. */
async function getPlayerSummary() {
  const qs = new URLSearchParams({ key: API_KEY, steamids: STEAM_ID, format: 'json' });
  const url = `${BASE}/ISteamUser/GetPlayerSummaries/v0002/?${qs}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`GetPlayerSummaries failed: ${res.status}`);
  const data = await res.json();
  /* The API returns an array of players (since you can query multiple IDs).
   * We always query just one, so grab the first element. Falls back to an
   * empty object if the array is somehow empty. */
  return data.response.players[0] || {};
}

/* ── Main pipeline ─────────────────────────────────────────────────────
 * This async IIFE (Immediately Invoked Function Expression) is the main
 * entry point. It orchestrates the entire fetch → transform → write flow.
 * Using an IIFE lets us use `await` at the top level (Node doesn't support
 * top-level await in CommonJS modules). */
(async function () {
  console.log('Fetching Steam data...');

  /* Fire all three API requests simultaneously with Promise.all(). This
   * runs them in parallel rather than sequentially, cutting total fetch
   * time from ~3 round trips to ~1 (they complete concurrently).
   * Destructuring assigns each resolved value to a named variable. */
  const [owned, recent, profile] = await Promise.all([
    getOwnedGames(),
    getRecentlyPlayed(),
    getPlayerSummary()
  ]);

  /* ── Aggregate stats ───────────────────────────────────────────────
   * Compute summary numbers from the raw game list. */
  const games = owned.games || [];
  const totalGames = owned.game_count || games.length;

  /* Steam stores playtime in minutes. Sum all games' lifetime playtime
   * and convert to hours for display. */
  const totalMinutes = games.reduce(function (sum, g) { return sum + (g.playtime_forever || 0); }, 0);
  const totalHours = Math.round(totalMinutes / 60);

  /* ── Top 10 by playtime ────────────────────────────────────────────
   * Sort a copy of the games array (`.slice()` prevents mutating the
   * original) by lifetime playtime descending, then take the first 10.
   * Each entry is mapped to a clean object with only the fields the
   * website needs: app ID, name, hours (rounded to 1 decimal), and icon. */
  const topByPlaytime = games
    .slice()
    .sort(function (a, b) {
      return (b.playtime_forever || 0) - (a.playtime_forever || 0);
    })
    .slice(0, 10)
    .map(function (g) {
      return {
        appid: g.appid,
        name: g.name,
        /* Convert minutes to hours with one decimal place.
         * Math.round(x * 10) / 10 is a common trick for rounding to 1 decimal. */
        hours: Math.round((g.playtime_forever || 0) / 60 * 10) / 10,
        img_icon_url: g.img_icon_url || ''
      };
    });

  /* ── Recently played ───────────────────────────────────────────────
   * Normalize the recent games list into a consistent shape. Each entry
   * includes both the two-week playtime (recent activity burst) and the
   * lifetime total (overall investment). */
  const recentGames = (recent.games || []).map(function (g) {
    return {
      appid: g.appid,
      name: g.name,
      hours_2weeks: Math.round((g.playtime_2weeks || 0) / 60 * 10) / 10,
      hours_total: Math.round((g.playtime_forever || 0) / 60 * 10) / 10,
      img_icon_url: g.img_icon_url || ''
    };
  });

  /* Count how many games have any playtime at all, and how many have
   * never been launched. */
  const playedCount = games.filter(function (g) { return (g.playtime_forever || 0) > 0; }).length;
  const neverPlayed = totalGames - playedCount;

  /* ── Playtime distribution buckets ─────────────────────────────────
   * Categorize every game into one of five playtime ranges. This powers
   * a quick "library shape" summary — e.g., "142 games under 1 hour,
   * 38 games over 100 hours." */
  const buckets = { '100h+': 0, '50-100h': 0, '10-50h': 0, '1-10h': 0, '<1h': 0 };
  games.forEach(function (g) {
    var h = (g.playtime_forever || 0) / 60;
    if (h >= 100) buckets['100h+']++;
    else if (h >= 50) buckets['50-100h']++;
    else if (h >= 10) buckets['10-50h']++;
    else if (h >= 1) buckets['1-10h']++;
    else if (h > 0) buckets['<1h']++;
  });

  /* ── Build output JSON ─────────────────────────────────────────────
   * This is the data contract that video-games.html consumes via
   * `fetch('steam-data.json')`. The structure must match what the
   * client-side rendering code expects — changing field names here
   * requires updating the HTML page's inline script too. */
  var output = {
    fetchedAt: new Date().toISOString(),
    profile: {
      name: profile.personaname || '',
      profileUrl: profile.profileurl || '',
      avatar: profile.avatarmedium || ''
    },
    stats: {
      totalGames: totalGames,
      totalHours: totalHours,
      playedCount: playedCount,
      neverPlayed: neverPlayed,
      playtimeBuckets: buckets
    },
    recentlyPlayed: recentGames,
    topByPlaytime: topByPlaytime
  };

  /* Write the JSON with 2-space indentation. Pretty-printing makes
   * `git diff` output readable when the file changes, so you can easily
   * see which stats or games shifted between daily runs. */
  var outPath = path.join(__dirname, 'steam-data.json');
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2));

  /* Print a summary to the console (visible in GitHub Actions logs
   * and in local terminal output). */
  console.log('Wrote ' + outPath);
  console.log('  Total games: ' + totalGames);
  console.log('  Total hours: ' + totalHours);
  console.log('  Recently played: ' + recentGames.length + ' games');
  console.log('  Top game: ' + (topByPlaytime[0] ? topByPlaytime[0].name + ' (' + topByPlaytime[0].hours + 'h)' : 'N/A'));
})().catch(function (err) {
  /* If any step throws (network error, bad API response, etc.), log the
   * error and exit with code 1. The non-zero exit code tells GitHub Actions
   * that this workflow step failed. */
  console.error('Error:', err.message);
  process.exit(1);
});
