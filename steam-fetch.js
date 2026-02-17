#!/usr/bin/env node
/**
 * steam-fetch.js
 * Build-time script that pulls data from the Steam Web API
 * and writes steam-data.json for the video games page.
 *
 * Usage:  node steam-fetch.js
 * Requires: .env with STEAM_API_KEY and STEAM_ID
 */

const fs = require('fs');
const path = require('path');

// ── Load .env ──────────────────────────────────────────────
const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
  fs.readFileSync(envPath, 'utf-8').split('\n').forEach(function (line) {
    const match = line.match(/^\s*([\w]+)\s*=\s*(.+?)\s*$/);
    if (match) process.env[match[1]] = match[2];
  });
}

const API_KEY = process.env.STEAM_API_KEY;
const STEAM_ID = process.env.STEAM_ID;

if (!API_KEY || !STEAM_ID) {
  console.error('Missing STEAM_API_KEY or STEAM_ID in .env');
  process.exit(1);
}

const BASE = 'https://api.steampowered.com';

// ── API helpers ────────────────────────────────────────────
async function steamGet(iface, method, version, params) {
  const qs = new URLSearchParams({ key: API_KEY, steamid: STEAM_ID, format: 'json', ...params });
  const url = `${BASE}/${iface}/${method}/v${version}/?${qs}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${method} failed: ${res.status}`);
  return res.json();
}

async function getOwnedGames() {
  const data = await steamGet('IPlayerService', 'GetOwnedGames', '0001', {
    include_appinfo: '1',
    include_played_free_games: '1'
  });
  return data.response;
}

async function getRecentlyPlayed() {
  const data = await steamGet('IPlayerService', 'GetRecentlyPlayedGames', '0001', {
    count: '10'
  });
  return data.response;
}

async function getPlayerSummary() {
  const qs = new URLSearchParams({ key: API_KEY, steamids: STEAM_ID, format: 'json' });
  const url = `${BASE}/ISteamUser/GetPlayerSummaries/v0002/?${qs}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`GetPlayerSummaries failed: ${res.status}`);
  const data = await res.json();
  return data.response.players[0] || {};
}

// ── Main ───────────────────────────────────────────────────
(async function () {
  console.log('Fetching Steam data...');

  const [owned, recent, profile] = await Promise.all([
    getOwnedGames(),
    getRecentlyPlayed(),
    getPlayerSummary()
  ]);

  const games = owned.games || [];
  const totalGames = owned.game_count || games.length;
  const totalMinutes = games.reduce(function (sum, g) { return sum + (g.playtime_forever || 0); }, 0);
  const totalHours = Math.round(totalMinutes / 60);

  // Top 10 by playtime
  const topByPlaytime = games
    .slice()
    .sort(function (a, b) { return (b.playtime_forever || 0) - (a.playtime_forever || 0); })
    .slice(0, 10)
    .map(function (g) {
      return {
        appid: g.appid,
        name: g.name,
        hours: Math.round((g.playtime_forever || 0) / 60 * 10) / 10,
        img_icon_url: g.img_icon_url || ''
      };
    });

  // Recently played
  const recentGames = (recent.games || []).map(function (g) {
    return {
      appid: g.appid,
      name: g.name,
      hours_2weeks: Math.round((g.playtime_2weeks || 0) / 60 * 10) / 10,
      hours_total: Math.round((g.playtime_forever || 0) / 60 * 10) / 10,
      img_icon_url: g.img_icon_url || ''
    };
  });

  // Games with any playtime vs never played
  const playedCount = games.filter(function (g) { return (g.playtime_forever || 0) > 0; }).length;
  const neverPlayed = totalGames - playedCount;

  // Playtime distribution buckets
  const buckets = { '100h+': 0, '50-100h': 0, '10-50h': 0, '1-10h': 0, '<1h': 0 };
  games.forEach(function (g) {
    var h = (g.playtime_forever || 0) / 60;
    if (h >= 100) buckets['100h+']++;
    else if (h >= 50) buckets['50-100h']++;
    else if (h >= 10) buckets['10-50h']++;
    else if (h >= 1) buckets['1-10h']++;
    else if (h > 0) buckets['<1h']++;
  });

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

  var outPath = path.join(__dirname, 'steam-data.json');
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2));
  console.log('Wrote ' + outPath);
  console.log('  Total games: ' + totalGames);
  console.log('  Total hours: ' + totalHours);
  console.log('  Recently played: ' + recentGames.length + ' games');
  console.log('  Top game: ' + (topByPlaytime[0] ? topByPlaytime[0].name + ' (' + topByPlaytime[0].hours + 'h)' : 'N/A'));
})().catch(function (err) {
  console.error('Error:', err.message);
  process.exit(1);
});
