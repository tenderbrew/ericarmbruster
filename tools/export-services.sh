#!/usr/bin/env bash
# tools/export-services.sh — refresh services-data.json from the homelab.
#
# Run from the dev box (needs SSH access to the homelab as tenderbrew):
#   bash tools/export-services.sh && git add services-data.json && git commit -m "chore: refresh services"
#
# Publishes container NAMES and compose PROJECTS only — no ports, IPs,
# versions, or images. Sidecar containers (-db, -redis, -worker, -ml)
# are filtered as implementation detail.
set -euo pipefail

HOST="tenderbrew@192.168.1.101"
DIR="$(dirname "$0")"
OUT="$DIR/../services-data.json"
TSV="$(mktemp)"
trap 'rm -f "$TSV"' EXIT
PYTHON=$(command -v python || command -v python3)

ssh "$HOST" 'docker ps --format "{{.Names}}\t{{.Label \"com.docker.compose.project\"}}"' > "$TSV"

"$PYTHON" - "$TSV" "$OUT" <<'PY'
import json, sys, datetime

tsv_path, out_path = sys.argv[1], sys.argv[2]
rows = [line.rstrip("\n").split("\t") for line in open(tsv_path, encoding="utf-8") if line.strip()]
names = {r[0] for r in rows}

def is_sidecar(name):
    for suffix in ("-db", "-redis", "-worker", "-ml", "-postgres", "-cache"):
        if name.endswith(suffix) and name[: -len(suffix)] in names:
            return True
    return False

services = sorted(
    ({"name": n, "project": p or "standalone"} for n, p in rows if not is_sidecar(n)),
    key=lambda s: (s["project"], s["name"]),
)
data = {
    "fetchedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z"),
    "note": "main services only; databases/caches/workers are filtered as implementation detail",
    "services": services,
}
with open(out_path, "w", encoding="utf-8") as f:
    json.dump(data, f, indent=2)
    f.write("\n")
print(f"{out_path}: {len(services)} services")
PY
