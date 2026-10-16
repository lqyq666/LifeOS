#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 2 ]]; then
  echo 'usage: bash deploy/verify-image.sh <env-file> <expected-40-char-commit>' >&2
  exit 2
fi

env_file=$1
expected_commit=$2
if [[ ! -r "$env_file" ]]; then
  echo 'ENV_FILE_UNREADABLE' >&2
  exit 2
fi
if [[ ! "$expected_commit" =~ ^[a-f0-9]{40}$ ]]; then
  echo 'EXPECTED_COMMIT_INVALID' >&2
  exit 2
fi

compose_json=$(docker compose --env-file "$env_file" config --format json)
mapfile -t compose_values < <(python3 -c '
import json, sys
config = json.load(sys.stdin)
app = config["services"]["app"]
print(app["image"])
print(app.get("build", {}).get("args", {}).get("LIFEOS_BUILD_COMMIT", ""))
' <<<"$compose_json")
image=${compose_values[0]:-}
compose_commit=${compose_values[1]:-}
if [[ -z "$image" || "$compose_commit" != "$expected_commit" ]]; then
  echo 'COMPOSE_IMAGE_OR_COMMIT_MISMATCH' >&2
  exit 1
fi

image_inspection=$(docker image inspect "$image" --format '{{.Id}} {{index .Config.Labels "org.opencontainers.image.revision"}}')
read -r image_id image_commit <<<"$image_inspection"
if [[ ! "$image_id" =~ ^sha256:[a-f0-9]{64}$ || "$image_commit" != "$expected_commit" ]]; then
  echo 'BUILT_IMAGE_COMMIT_MISMATCH' >&2
  exit 1
fi

python3 -c 'import json,sys; print(json.dumps({"status":"IMAGE_PREFLIGHT_PASS","image":sys.argv[1],"imageId":sys.argv[2],"commit":sys.argv[3]},separators=(",",":")))' "$image" "$image_id" "$image_commit"
