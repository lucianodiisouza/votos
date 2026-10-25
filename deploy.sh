#!/bin/sh
# Carimba um build id novo; clientes abertos recarregam sozinhos no próximo ciclo de 30s.
set -e
cd "$(dirname "$0")"
V=$(date +%s)
mkdir -p .out
cp -R index.html static.js sw.js manifest.webmanifest og.png icons vercel.json .out/
cp -R .vercel .out/ 2>/dev/null || true
sed -i '' "s/__BUILD__/$V/g" .out/index.html .out/sw.js
printf '{"v":"%s"}' "$V" > .out/version.json
cd .out && vercel deploy --prod --yes --scope oprimodev
