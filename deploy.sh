#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

if [[ -f .env ]]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

: "${REMOTE_HOST:?Set REMOTE_HOST}"
: "${REMOTE_USER:=deploy}"
: "${REMOTE_APP_DIR:=/srv/apps/vehicles}"

ssh "${REMOTE_USER}@${REMOTE_HOST}" "cd '${REMOTE_APP_DIR}' && git pull && docker compose up -d --build"
