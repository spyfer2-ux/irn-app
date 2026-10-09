#!/usr/bin/env bash
# Sobe o app local com banco limpo + login do Google de teste, roda o teste de ponta a ponta e desliga tudo.
set -u
cd "$(dirname "$0")/.."
LOGS=${LOGS:-/tmp/irn-e2e}; mkdir -p "$LOGS"
stop() { python3 tests/stop-servers.py > /dev/null; rm -f "$LOGS"/*.pid; sleep 2; }
stop
rm -rf .wrangler/state .wrangler/state-r2 tests/.wrangler
npx vite build > "$LOGS/build.log" 2>&1 || { echo "build falhou"; tail "$LOGS/build.log"; exit 1; }
cp tests/dev.vars.example .dev.vars
cp tests/dev.vars.example tests/.dev.vars
node tests/fake-google.mjs 9555 > "$LOGS/google.log" 2>&1 & echo $! > "$LOGS/google.pid"
NO_PROXY="127.0.0.1,localhost" no_proxy="127.0.0.1,localhost" npx wrangler dev ${WRANGLER_ARGS:-} --port 8787 --ip 127.0.0.1 > "$LOGS/wrangler.log" 2>&1 & echo $! > "$LOGS/wrangler.pid"
for i in $(seq 1 60); do curl -s -o /dev/null http://127.0.0.1:8787/api/boot && break; sleep 1; done
node "${E2E:-tests/e2e.mjs}"; code=$?
[ "${KEEP:-0}" = "1" ] || stop
exit $code
