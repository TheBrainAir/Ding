#!/usr/bin/env bash
# Ding local dev runner.
#
#   ./dev.sh            backend (:8010) + web (:5173) together; Ctrl+C stops both
#   ./dev.sh backend    backend only (auto-reload)
#   ./dev.sh web        web only
#   ./dev.sh seed       create / refresh the demo restaurant (prints login + table URLs)
#   ./dev.sh test       backend lint + tests
#
# First run: put your keys in backend/.env (see backend/.env.example). The demo data
# is seeded automatically when the database does not exist yet.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
BACKEND="$ROOT/backend"
WEB="$ROOT/web"
PORT=8010

need() {
  command -v "$1" >/dev/null 2>&1 || { echo "error: '$1' is not installed ($2)" >&2; exit 1; }
}

prepare_backend() {
  need uv "https://docs.astral.sh/uv/"
  if [ ! -f "$BACKEND/.env" ]; then
    cp "$BACKEND/.env.example" "$BACKEND/.env"
    echo "created backend/.env from .env.example: add ANTHROPIC_API_KEY (and ELEVENLABS_API_KEY for voice)"
  fi
  (cd "$BACKEND" && uv sync --quiet)
  if [ ! -f "$BACKEND/data/ding.db" ]; then
    echo "no database yet: seeding demo data"
    (cd "$BACKEND" && uv run python scripts/seed_demo.py)
  fi
}

run_backend() {
  cd "$BACKEND"
  exec uv run uvicorn app.main:app --reload --reload-dir app --host 127.0.0.1 --port "$PORT"
}

prepare_web() {
  need npm "Node.js 20+"
  if [ ! -d "$WEB/node_modules" ]; then
    (cd "$WEB" && npm install)
  fi
}

run_web() {
  cd "$WEB"
  exec npm run dev
}

case "${1:-all}" in
  backend)
    prepare_backend
    run_backend
    ;;
  web)
    prepare_web
    run_web
    ;;
  seed)
    need uv "https://docs.astral.sh/uv/"
    cd "$BACKEND" && exec uv run python scripts/seed_demo.py
    ;;
  test)
    need uv "https://docs.astral.sh/uv/"
    cd "$BACKEND" && uv run ruff check app && exec uv run pytest
    ;;
  all)
    prepare_backend
    [ -f "$WEB/package.json" ] && prepare_web
    (run_backend) &
    backend_pid=$!
    web_pid=""
    if [ -f "$WEB/package.json" ]; then
      (run_web) &
      web_pid=$!
    fi
    trap 'kill $backend_pid $web_pid 2>/dev/null; wait 2>/dev/null; exit 0' INT TERM
    echo "backend  http://localhost:$PORT/docs"
    echo "web      http://localhost:5173  (dashboard: /dashboard, table screens: /t/<token>)"
    # Stop everything as soon as either process exits (bash 3.2 has no `wait -n`).
    while kill -0 "$backend_pid" 2>/dev/null && { [ -z "$web_pid" ] || kill -0 "$web_pid" 2>/dev/null; }; do
      sleep 1
    done
    kill $backend_pid $web_pid 2>/dev/null || true
    wait 2>/dev/null || true
    ;;
  *)
    sed -n '2,10p' "$0"
    exit 1
    ;;
esac
