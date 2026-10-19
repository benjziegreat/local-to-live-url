#!/usr/bin/env sh
cd "$(dirname "$0")" || exit 1
command -v node >/dev/null 2>&1 || { echo "Node.js 20+ is required: https://nodejs.org"; exit 1; }
command -v cloudflared >/dev/null 2>&1 || echo "WARNING: cloudflared not found on PATH - tunnels will fail to start."
exec node src/index.js
