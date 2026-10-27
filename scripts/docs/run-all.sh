#!/usr/bin/env bash
# Pipeline completo e reproduzível da documentação. Requer Docker e Node 22. Não acessa produção nem o Docs Helper.
set -euo pipefail
cd "$(dirname "$0")/../.."
[ -d scripts/docs/node_modules ] || (cd scripts/docs && npm ci --no-audit --no-fund)
scripts/docs/introspect-schema.sh        # schema real das migrations → docs/database/generated/schema.json
node scripts/docs/gen-database.mjs       # dicionário de dados + DERs (.mmd)
scripts/docs/render-diagrams.sh          # .mmd → SVG/PNG
node scripts/docs/build.mjs              # md → HTML, docs-index.json, ZIP
node scripts/docs/validate.mjs           # índice, limites, links, sanitização, fidelidade ao código
