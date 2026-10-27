// Gera docs/database/data-dictionary.md e os DERs Mermaid a partir de docs/database/generated/schema.json.
import fs from 'node:fs';
const S = JSON.parse(fs.readFileSync('docs/database/generated/schema.json', 'utf8'));

const PURPOSE = {
  tenants: 'Organização cliente (raiz do isolamento multi-tenant). Guarda limite de atendimentos simultâneos e política de histórico interno.',
  sites: 'Site/widget de um tenant, identificado por `public_id`; guarda origens permitidas e aparência do widget.',
  queues: 'Fila de atendimento externo do tenant.',
  site_queues: 'Filas oferecidas por cada site (N:N).',
  agents: 'Usuário interno (agent, supervisor ou admin) com credencial local (hash argon2id).',
  agent_queues: 'Filas que cada agente pode atender (N:N).',
  auth_sessions: 'Sessões opacas de agentes/supervisores/admin (apenas o hash SHA-256 do token).',
  visitors: 'Visitante anônimo de um site.',
  visitor_sessions: 'Sessões opacas de visitantes (apenas o hash do token).',
  dispositions: 'Classificações de encerramento de atendimento.',
  survey_definitions: 'Definição da pesquisa de satisfação do tenant.',
  survey_responses: 'Resposta da pesquisa (no máximo uma por atendimento).',
  conversations: 'Atendimento externo (visitante ↔ fila/agente). Máquina de estados por `status`.',
  messages: 'Mensagens de um atendimento externo (idempotentes por `request_id`).',
  conversation_events: 'Linha do tempo durável do atendimento (queued, assigned, released, transferred, classified, survey_submitted, closed, left).',
  conversation_reads: 'Cursor de leitura do agente por atendimento.',
  agent_presence: 'Status desejado do agente (available, busy, away).',
  agent_connections: 'Conexões WebSocket ativas com heartbeat; base da conectividade (offline = sem conexão fresca).',
  presence_intervals: 'Histórico de intervalos de presença efetiva (inclui offline).',
  sectors: 'Setor organizacional do tenant.',
  sector_members: 'Membros do setor (remoção lógica por `removed_at`).',
  sector_supervisors: 'Supervisores do setor (remoção lógica por `removed_at`).',
  sector_queues: 'Vínculo setor ↔ fila usado para limitar o escopo da supervisão.',
  login_rate_limits: 'Contadores globais do limite de login; chaves são HMAC de IP e conta, sem dados em claro.',
  audit_events: 'Trilha de auditoria de ações administrativas e de supervisão.',
  internal_conversations: 'Conversa do chat interno: `direct` (par) ou `group` (um por setor).',
  internal_participants: 'Participantes da conversa interna (remoção lógica por `removed_at`).',
  internal_messages: 'Mensagens do chat interno (idempotentes por `request_id`).',
  internal_reads: 'Cursor de leitura do chat interno por participante.',
  announcements: 'Anúncio do quadro (público tenant ou setores; fixação, expiração, arquivamento).',
  announcement_sectors: 'Setores-alvo de um anúncio.',
  announcement_revisions: 'Revisões (título/corpo) de um anúncio editado.',
  announcement_reads: 'Registro de leitura do anúncio por agente.',
  activity_types: 'Catálogo de tipos de atividade (gerido por admin).',
  activity_assignments: 'Alocações de atividade a agentes (no máximo uma ativa por agente).',
  schema_migrations: 'Controle das migrations aplicadas.',
};

const DOMAINS = {
  identity: ['tenants','sites','queues','site_queues','agents','agent_queues','auth_sessions','visitors','visitor_sessions'],
  attendance: ['sites','queues','visitors','agents','dispositions','conversations','messages','conversation_events','conversation_reads','survey_definitions','survey_responses'],
  internal: ['agents','sectors','internal_conversations','internal_participants','internal_messages','internal_reads'],
  sectors: ['agents','queues','sectors','sector_members','sector_supervisors','sector_queues','announcements','announcement_sectors','announcement_revisions','announcement_reads','audit_events'],
  presence: ['agents','agent_presence','agent_connections','presence_intervals','activity_types','activity_assignments'],
};

const tables = [...new Set(S.columns.map(c => c.t))].sort();
const cols = t => S.columns.filter(c => c.t === t);
const cons = t => S.constraints.filter(c => c.t === t);
const pk = t => { const c = cons(t).find(c => c.kind === 'p'); return c ? c.def.match(/\((.*)\)/)[1].split(',').map(s => s.trim()) : []; };
const uniqueSingle = t => new Set(cons(t).filter(c => c.kind === 'u').map(c => c.def.match(/UNIQUE \(([^)]*)\)/)?.[1]).filter(x => x && !x.includes(',')));
const fks = t => cons(t).filter(c => c.kind === 'f').map(c => {
  const m = c.def.match(/FOREIGN KEY \((.*?)\) REFERENCES (\w+)\((.*?)\)(.*)/);
  return { name: c.name, cols: m[1].split(',').map(s => s.trim()), ref: m[2], refCols: m[3].split(',').map(s => s.trim()), rest: m[4].trim() };
});
const esc = s => String(s ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
const typ = c => c.typ === 'ARRAY' ? c.udt.replace(/^_/, '') + '[]' : c.typ === 'character varying' && c.len ? `varchar(${c.len})` : c.typ.replace('timestamp with time zone','timestamptz');

let md = `# Dicionário de dados

> Gerado por \`scripts/docs/gen-database.mjs\` a partir de \`docs/database/generated/schema.json\`, extraído por \`scripts/docs/introspect-schema.sh\` (migrations \`apps/server/migrations/001–007\` aplicadas em um PostgreSQL 16 descartável; nenhum dado real). **Não edite à mão**: altere o gerador.

Convenções: toda tabela de negócio tem \`tenant_id\` (FK para \`tenants\`), RLS **habilitada e forçada** e a política \`tenant_isolation\` (\`tenant_id = app_tenant_id()\`); \`tenants\` usa \`tenant_self\`. Tipos enumerados são \`text\` com \`CHECK\` (não há \`ENUM\` nativo).

## Índice de tabelas

${tables.map(t => `- [\`${t}\`](#${t})`).join('\n')}
`;

for (const t of tables) {
  const pks = pk(t), uq = uniqueSingle(t);
  md += `\n## ${t}\n\n${PURPOSE[t] ?? ''}\n\n| Coluna | Tipo | Nulo? | Padrão | Observação |\n|---|---|---|---|---|\n`;
  for (const c of cols(t)) {
    const notes = [];
    if (pks.includes(c.col)) notes.push('PK');
    const fk = fks(t).find(f => f.cols.includes(c.col));
    if (fk) notes.push(`FK → ${fk.ref}.${fk.refCols[fk.cols.indexOf(c.col)]}`);
    if (uq.has(c.col)) notes.push('UNIQUE');
    md += `| \`${c.col}\` | ${typ(c)} | ${c.nullable === 'YES' ? 'sim' : 'não'} | ${c.def ? '`' + esc(c.def) + '`' : ''} | ${notes.join(', ')} |\n`;
  }
  md += `\n**Chave primária:** ${pks.map(p => '`' + p + '`').join(', ') || '—'}\n`;
  const f = fks(t);
  if (f.length) md += `\n**Chaves estrangeiras:**\n${f.map(x => `- \`${x.cols.join(', ')}\` → \`${x.ref}(${x.refCols.join(', ')})\` ${x.rest}`.trim()).join('\n')}\n`;
  const other = cons(t).filter(c => ['u','c'].includes(c.kind));
  if (other.length) md += `\n**Constraints (UNIQUE/CHECK):**\n${other.map(c => `- \`${c.name}\`: \`${esc(c.def)}\``).join('\n')}\n`;
  const idx = S.indexes.filter(i => i.tablename === t);
  if (idx.length) md += `\n**Índices:**\n${idx.map(i => `- \`${i.indexname}\`: \`${esc(i.indexdef)}\``).join('\n')}\n`;
  const trg = S.triggers.filter(g => g.t === t);
  if (trg.length) md += `\n**Triggers:**\n${trg.map(g => `- \`${g.name}\``).join('\n')}\n`;
  const r = S.rls.find(x => x.t === t), pol = S.policies.filter(p => p.tablename === t);
  md += `\n**RLS:** ${r.enabled ? 'habilitada' : 'não habilitada'}${r.forced ? ' e forçada' : ''}${pol.length ? ' — política ' + pol.map(p => `\`${p.policyname}\` (${p.cmd})`).join(', ') : ''}\n`;
}
fs.writeFileSync('docs/database/data-dictionary.md', md);

// --- DER Mermaid
function erd(set, title) {
  const include = new Set(set);
  let out = `---\ntitle: ${title}\n---\nerDiagram\n  %% Relacionamentos tenant_id → tenants omitidos (toda tabela de negócio os possui).\n`;
  for (const t of set) {
    out += `  ${t} {\n`;
    const pks = pk(t);
    for (const c of cols(t)) {
      const fk = fks(t).some(f => f.cols.includes(c.col));
      if (pks.includes(c.col) || (fk && c.col !== 'tenant_id'))
        out += `    ${typ(c).replace(/[ ()]/g, '_')} ${c.col} ${[pks.includes(c.col) ? 'PK' : '', fk && c.col !== 'tenant_id' ? 'FK' : ''].filter(Boolean).join(',')}\n`;
    }
    out += `  }\n`;
  }
  for (const t of set) for (const f of fks(t)) {
    if (!include.has(f.ref)) continue;
    if (f.cols.length === 1 && f.cols[0] === 'tenant_id') continue; // omitido p/ legibilidade (toda tabela tem tenant_id)
    const col = cols(t).find(c => f.cols.includes(c.col) && c.col !== 'tenant_id');
    if (!col) continue;
    const nullable = f.cols.every(x => cols(t).find(c => c.col === x).nullable === 'YES');
    const oneToOne = (pk(t).length === 1 && pk(t)[0] === f.cols[0]) || uniqueSingle(t).has(f.cols[0]);
    const left = nullable ? '|o' : '||';
    const right = oneToOne ? 'o|' : 'o{';
    if (f.cols.includes('tenant_id') && f.cols.length > 1) continue;
    out += `  ${f.ref} ${left}--${right} ${t} : "${f.cols.filter(c => c !== 'tenant_id').join('+')}"\n`;
  }
  return out;
}
const nonTenantEdgeNote = '%% Relacionamentos tenant_id → tenants omitidos (todas as tabelas de negócio os possuem).\n';
fs.writeFileSync('docs/diagrams/database-erd.mmd', erd(tables.filter(t => t !== 'schema_migrations'), 'DER geral — ViaVoip Webchat (apenas PK/FK)'));
for (const [k, v] of Object.entries(DOMAINS)) fs.writeFileSync(`docs/diagrams/database-erd-${k}.mmd`, erd(v, `DER — ${k}`));
console.log('ok', tables.length, 'tabelas');
