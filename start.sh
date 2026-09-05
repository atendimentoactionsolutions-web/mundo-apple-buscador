#!/bin/bash
cd "$(dirname "$0")"
export PATH="/Users/imac27/.gemini/antigravity/bin:$PATH"

echo "========================================================"
echo "🍏 INICIANDO BUSCADOR PXT - APPLE PRO (TEMPO REAL)"
echo "========================================================"

if [ ! -d "node_modules" ]; then
  echo "Instalando dependências..."
  npm install
fi

echo "Iniciando servidor local..."
node server.js
