#!/usr/bin/env bash
# tools/export-music.sh — refresh music-data.json from Tautulli's Plex
# listening history on the homelab.
#
# Run from the dev box (needs SSH access as tenderbrew):
#   bash tools/export-music.sh && git add music-data.json && git commit -m "chore: refresh music"
#
# The Tautulli API key is read ON the homelab and never leaves it; only
# track history (artist/album/track/timestamp) comes back.
set -euo pipefail

HOST="tenderbrew@192.168.1.101"
DIR="$(dirname "$0")"
OUT="$DIR/../music-data.json"
RAW="$(mktemp)"
trap 'rm -f "$RAW"' EXIT
PYTHON=$(command -v python || command -v python3)

ssh "$HOST" 'bash -s' > "$RAW" <<'REMOTE'
key=$(sed -n "s/^api_key = //p" /opt/docker/tautulli/config/config.ini | head -1)
curl -s "http://localhost:8181/api/v2?apikey=${key}&cmd=get_history&media_type=track&length=500"
REMOTE

"$PYTHON" - "$RAW" "$OUT" <<'PY'
import json, sys, datetime, collections

raw_path, out_path = sys.argv[1], sys.argv[2]
rows = json.load(open(raw_path, encoding="utf-8"))["response"]["data"]["data"]

tracks = [
    {
        "artist": r.get("grandparent_title") or "",
        "album": r.get("parent_title") or "",
        "track": r.get("title") or "",
        "played": r.get("date"),
    }
    for r in rows
    if r.get("grandparent_title")
]

artists = collections.Counter(t["artist"] for t in tracks)
albums = collections.Counter((t["artist"], t["album"]) for t in tracks if t["album"])

data = {
    "fetchedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z"),
    "windowPlays": len(tracks),
    "recentTracks": tracks[:25],
    "topArtists": [{"artist": a, "plays": n} for a, n in artists.most_common(10)],
    "topAlbums": [{"artist": a, "album": b, "plays": n} for (a, b), n in albums.most_common(10)],
}
with open(out_path, "w", encoding="utf-8") as f:
    json.dump(data, f, indent=2, ensure_ascii=False)
    f.write("\n")
print(f"{out_path}: {len(tracks)} plays, {len(artists)} artists")
PY
