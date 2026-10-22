#!/usr/bin/env bash
# Starts RustFS (S3-compatible storage) for local development, bound to 127.0.0.1.
# Reads S3_ACCESS_KEY / S3_SECRET_KEY / RUSTFS_* from .env (see .env.example).
# Flags follow https://docs.rustfs.com (server --address --console-enable --console-address <data dir>; --console-enable is a bare flag in 1.0.3).
set -euo pipefail

cd "$(dirname "$0")/.."

# Read only the keys we need from .env (no `source`, so odd values cannot run code).
env_value() {
  [ -f .env ] || return 0
  grep -E "^$1=" .env | tail -n1 | cut -d= -f2- | sed -E 's/^"(.*)"$/\1/; s/^'"'"'(.*)'"'"'$/\1/' || true
}
get() { local v="${!1:-}"; [ -n "$v" ] && echo "$v" || { v="$(env_value "$1")"; echo "${v:-${2:-}}"; }; }

RUSTFS_BIN="$(get RUSTFS_BIN "$HOME/rustfs/bin/rustfs")"
RUSTFS_BIN="${RUSTFS_BIN/#\~/$HOME}"
RUSTFS_DATA_DIR="$(get RUSTFS_DATA_DIR "$HOME/rustfs/data")"
RUSTFS_DATA_DIR="${RUSTFS_DATA_DIR/#\~/$HOME}"
RUSTFS_PORT="$(get RUSTFS_PORT 9000)"
RUSTFS_CONSOLE_PORT="$(get RUSTFS_CONSOLE_PORT 9001)"
ACCESS_KEY="$(get S3_ACCESS_KEY)"
SECRET_KEY="$(get S3_SECRET_KEY)"

if [ ! -x "$RUSTFS_BIN" ]; then
  echo "RustFS binary not found at: $RUSTFS_BIN" >&2
  echo "Download it from https://docs.rustfs.com (installation > macOS), make it executable," >&2
  echo "or set RUSTFS_BIN in .env to its path." >&2
  exit 1
fi
if [ -z "$ACCESS_KEY" ] || [ -z "$SECRET_KEY" ]; then
  echo "Set S3_ACCESS_KEY and S3_SECRET_KEY in .env first." >&2
  exit 1
fi

for port in "$RUSTFS_PORT" "$RUSTFS_CONSOLE_PORT"; do
  if lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then
    echo "Port $port is already in use. Stop the other process or change RUSTFS_PORT / RUSTFS_CONSOLE_PORT." >&2
    exit 1
  fi
done

mkdir -p "$RUSTFS_DATA_DIR"

echo "RustFS: S3 API http://127.0.0.1:$RUSTFS_PORT  console http://127.0.0.1:$RUSTFS_CONSOLE_PORT  data $RUSTFS_DATA_DIR"
export RUSTFS_ACCESS_KEY="$ACCESS_KEY" RUSTFS_SECRET_KEY="$SECRET_KEY"
exec "$RUSTFS_BIN" server \
  --address "127.0.0.1:$RUSTFS_PORT" \
  --console-enable \
  --console-address "127.0.0.1:$RUSTFS_CONSOLE_PORT" \
  "$RUSTFS_DATA_DIR"
