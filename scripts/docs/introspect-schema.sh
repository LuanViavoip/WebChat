#!/usr/bin/env bash
# Aplica as migrations em um Postgres descartável (Docker) e extrai o schema real
# para docs/database/generated/schema.json. Nenhum dado real é usado.
set -euo pipefail
cd "$(dirname "$0")/../.."
NAME=vv-doc-pg-$$
PORT_UNUSED=
docker run -d --rm --name "$NAME" -e POSTGRES_PASSWORD=doc postgres:16-alpine >/dev/null
trap 'docker stop "$NAME" >/dev/null 2>&1 || true' EXIT
for i in $(seq 1 60); do docker exec "$NAME" pg_isready -U postgres >/dev/null 2>&1 && break; sleep 1; done
sleep 2
for f in apps/server/migrations/*.sql; do
  docker exec -i "$NAME" psql -U postgres -v ON_ERROR_STOP=1 -q < "$f" >/dev/null 2>&1
done
Q() { docker exec "$NAME" psql -U postgres -Atqc "$1"; }
OUT=docs/database/generated/schema.json
Q "select json_build_object(
 'columns', (select json_agg(c order by c.t, c.n) from (
    select table_name t, ordinal_position n, column_name col, data_type typ, udt_name udt,
           character_maximum_length len, is_nullable nullable, column_default def
    from information_schema.columns where table_schema='public') c),
 'constraints', (select json_agg(x order by x.t, x.name) from (
    select cl.relname t, co.conname name, co.contype kind, pg_get_constraintdef(co.oid) def
    from pg_constraint co join pg_class cl on cl.oid=co.conrelid
    join pg_namespace ns on ns.oid=cl.relnamespace where ns.nspname='public') x),
 'indexes', (select json_agg(i order by i.tablename, i.indexname) from (
    select tablename, indexname, indexdef from pg_indexes where schemaname='public') i),
 'triggers', (select json_agg(g order by g.t, g.name) from (
    select c.relname t, tg.tgname name, pg_get_triggerdef(tg.oid) def
    from pg_trigger tg join pg_class c on c.oid=tg.tgrelid
    join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and not tg.tgisinternal) g),
 'policies', (select json_agg(p order by p.tablename, p.policyname) from (
    select tablename, policyname, cmd, qual, with_check from pg_policies where schemaname='public') p),
 'rls', (select json_agg(r order by r.t) from (
    select c.relname t, c.relrowsecurity enabled, c.relforcerowsecurity forced
    from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relkind='r') r),
 'functions', (select json_agg(f order by f.name) from (
    select p.proname name, p.prosecdef secdef from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public'
      and not exists (select 1 from pg_depend d where d.objid=p.oid and d.deptype='e')) f)
)" | python3 -m json.tool > "$OUT"
echo "schema extraído em $OUT"
