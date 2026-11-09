#!/usr/bin/env bash
set -euo pipefail

REMOTE="root@179.236.75.100"
REMOTE_PATH="/var/www/mundo-apple-buscador"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

command -v rsync >/dev/null || {
  echo "Erro: rsync não está instalado neste computador." >&2
  exit 1
}
command -v ssh >/dev/null || {
  echo "Erro: ssh não está instalado neste computador." >&2
  exit 1
}

rsync -az \
  --exclude='.git/' \
  --exclude='node_modules/' \
  --exclude='.env' \
  --exclude='.env.*' \
  --exclude='data/' \
  --exclude='*.bak' \
  --exclude='*.backup-*' \
  --exclude='.DS_Store' \
  "$ROOT_DIR/" "$REMOTE:$REMOTE_PATH/"

ssh "$REMOTE" "cd '$REMOTE_PATH' &&
  node --check server.js &&
  node --check public/js/app.js &&
  node --check public/js/pricing-core.js &&
  pm2 restart buscador --update-env &&
  for attempt in \$(seq 1 20); do
    if curl -fsS --max-time 2 http://127.0.0.1:3333/ >/dev/null 2>&1; then
      echo 'VPS responded successfully.'
      exit 0
    fi
    sleep 1
  done
  echo 'The VPS app did not respond after restart.' >&2
  exit 1"

echo "Publicação concluída e VPS respondendo."
