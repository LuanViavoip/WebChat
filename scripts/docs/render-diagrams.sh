#!/usr/bin/env bash
# Renderiza docs/diagrams/*.mmd em SVG e PNG (docs/diagrams/rendered/) com o mermaid-cli oficial em Docker.
# Falha se qualquer diagrama não renderizar.
set -euo pipefail
cd "$(dirname "$0")/../.."
IMG=ghcr.io/mermaid-js/mermaid-cli/mermaid-cli:11.4.2
mkdir -p docs/diagrams/rendered
fail=0
for f in docs/diagrams/*.mmd; do
  n=$(basename "$f" .mmd)
  nfail=0
  for ext in svg png; do
    extra=(); [ "$ext" = png ] && extra=(-s 2 -b white)
    if ! docker run --rm -u "$(id -u):$(id -g)" -v "$PWD/docs/diagrams:/data" "$IMG" \
         -p /data/puppeteer-config.json -c /data/mermaid-config.json \
         -i "/data/$n.mmd" -o "/data/rendered/$n.$ext" "${extra[@]}" >/tmp/mmd-$n.log 2>&1; then
      echo "FALHA: $n.$ext"; sed -n 1,8p /tmp/mmd-$n.log; fail=1; nfail=1
    fi
  done
  [ "$nfail" = 0 ] && echo "ok: $n"
done
exit $fail
