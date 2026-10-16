#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
umask 077
mkdir -p .local/backups
file=".local/backups/lifeos-$(date -u +%Y%m%dT%H%M%SZ).dump"
test ! -e "$file"
docker compose --env-file .env.production exec -T db pg_dump -U lifeos -d lifeos -Fc > "$file.partial"
test -s "$file.partial"
mv "$file.partial" "$file"
sha256sum "$file" > "$file.sha256"
printf '%s\n' "$file"
# Backups contain private records. Copy to a separate protected location; no automatic deletion.
