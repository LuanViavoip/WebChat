// Valida: índice (regras do schema do Docs Helper), arquivos/limites, links/âncoras/imagens, sanitização,
// e correspondência documentação × código (tabelas, eventos). Sai com código 1 se houver erro.
// Uso: node scripts/docs/validate.mjs
import fs from 'node:fs';
import path from 'node:path';
import sanitizeHtml from 'sanitize-html';
import { MODULES, pageHtmlPath } from './pages.mjs';

const DOCS = path.resolve('docs'), OUT = path.join(DOCS, 'docs-helper');
const errors = [], warns = [];
const err = m => errors.push(m), warn = m => warns.push(m);

// ---- 1. Índice (espelha src/features/importer/index-schema.ts e constants.ts)
const index = JSON.parse(fs.readFileSync(path.join(OUT, 'index/docs-index.json'), 'utf8'));
const L = { title: 200, slug: 80, type: 40, name: 120, desc: 500 };
if (Buffer.byteLength(JSON.stringify(index)) > 2 * 1024 * 1024) err('índice > 2 MB');
if (!index.system?.name || index.system.name.length > L.name) err('system.name inválido');
if ((index.system?.description ?? '').length > L.desc) err('system.description > 500');
if (!Array.isArray(index.documents) || !index.documents.length) err('documents vazio');
const KEYS = new Set(['title', 'slug', 'type', 'file', 'contentUrl', 'profiles', 'examples', 'children']);
const files = new Set();
function checkDoc(d, trail) {
  const where = `${trail}/${d.slug ?? d.title ?? d.file}`;
  for (const k of Object.keys(d)) if (!KEYS.has(k)) err(`${where}: chave desconhecida "${k}"`);
  if (d.title === undefined && d.file === undefined) err(`${where}: sem title nem file`);
  if (d.file && d.contentUrl) err(`${where}: file e contentUrl juntos`);
  if (d.contentUrl) err(`${where}: contentUrl remoto não é suportado pelo importador`);
  if (d.title && d.title.length > L.title) err(`${where}: title > 200`);
  if (d.slug && d.slug.length > L.slug) err(`${where}: slug > 80`);
  if (d.type && d.type.length > L.type) err(`${where}: type > 40`);
  if (d.profiles) err(`${where}: profiles não deve ser usado (perfis desconhecidos bloqueiam a importação)`);
  if (d.file) {
    if (!/\.html?$/i.test(d.file)) err(`${where}: file não é HTML`);
    if (/(^|\/)\.\.(\/|$)|^\//.test(d.file)) err(`${where}: caminho inseguro`);
    if (!fs.existsSync(path.join(OUT, d.file))) err(`${where}: arquivo inexistente ${d.file}`);
    files.add(d.file);
  }
  const slugs = new Set();
  for (const c of d.children ?? []) { if (c.slug && slugs.has(c.slug)) err(`${where}: slug duplicado ${c.slug}`); slugs.add(c.slug); checkDoc(c, where); }
}
const top = new Set();
for (const d of index.documents) { if (top.has(d.slug)) err(`slug duplicado ${d.slug}`); top.add(d.slug); checkDoc(d, ''); }
const expected = MODULES.flatMap(m => m.pages.map(p => pageHtmlPath(m, p)));
for (const e of expected) if (!files.has(e)) err(`página prevista fora do índice: ${e}`);

// ---- 2. Limites do pacote
const walk = d => fs.readdirSync(d, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]);
const pkg = [...walk(path.join(OUT, 'html')), ...walk(path.join(OUT, 'assets'))];
if (pkg.length + 1 > 3000) err('mais de 3000 arquivos');
for (const f of pkg) {
  const s = fs.statSync(f).size;
  if (f.endsWith('.html') && s > 2 * 1024 * 1024) err(`HTML > 2 MB: ${f}`);
  if (/\.(png|svg)$/.test(f) && s > 10 * 1024 * 1024) err(`imagem > 10 MB: ${f}`);
}
const zipPath = path.join(OUT, 'dist/viavoip-webchat-docs.zip');
if (!fs.existsSync(zipPath)) err('ZIP não gerado'); else if (fs.statSync(zipPath).size > 50 * 1024 * 1024) err('ZIP > 50 MB');

// ---- 3. HTML: segurança, links, âncoras, imagens, sanitização (mesma allowlist do Docs Helper)
const ALLOWED_TAGS = ['h1','h2','h3','h4','h5','h6','p','a','img','figure','figcaption','ul','ol','li','dl','dt','dd','table','caption','colgroup','col','thead','tbody','tfoot','tr','th','td','pre','code','kbd','samp','blockquote','strong','b','em','i','u','s','del','ins','mark','small','sub','sup','br','hr','div','span','section','article','aside','details','summary'];
const SAN = { allowedTags: ALLOWED_TAGS, allowedAttributes: { '*': ['id','class','title','lang','dir'], a: ['href','name','target','rel'], img: ['src','alt','width','height','loading'], th: ['colspan','rowspan','scope','align'], td: ['colspan','rowspan','align'], col: ['span'], colgroup: ['span'], ol: ['start','type','reversed'], details: ['open'] }, allowedSchemes: ['http','https','mailto','tel'], allowedSchemesByTag: { img: ['http','https','data'] }, allowProtocolRelative: false, disallowedTagsMode: 'discard', nonTextTags: ['script','style','textarea','option','noscript','template','title'] };
const idsOf = h => new Set([...h.matchAll(/\sid="([^"]+)"/g)].map(m => m[1]));
const tagCount = h => { const c = {}; for (const m of h.matchAll(/<([a-z][a-z0-9]*)[\s>\/]/gi)) c[m[1].toLowerCase()] = (c[m[1].toLowerCase()] ?? 0) + 1; return c; };
const WRAP = new Set(['html', 'head', 'meta', 'title', 'body']);
let nLinks = 0, nImgs = 0;
for (const f of files) {
  const html = fs.readFileSync(path.join(OUT, f), 'utf8'), dir = path.posix.dirname(f);
  if (/<(script|style|iframe|object|embed|form|svg)\b|\son\w+=|style=/i.test(html)) err(`${f}: conteúdo não permitido (script/style/iframe/svg/on*/style)`);
  const clean = sanitizeHtml(html, SAN), before = tagCount(html), after = tagCount(clean);
  for (const [t, n] of Object.entries(before)) if (!WRAP.has(t) && (after[t] ?? 0) !== n) err(`${f}: a sanitização remove <${t}> (${n} → ${after[t] ?? 0})`);
  if (!/<h1[\s>]/.test(html)) warn(`${f}: sem <h1>`);
  for (const m of html.matchAll(/<img\b[^>]*>/g)) {
    nImgs++; const src = /\ssrc="([^"]+)"/.exec(m[0])?.[1];
    if (!src) { err(`${f}: <img> sem src`); continue; }
    const t = path.posix.normalize(path.posix.join(dir, src));
    if (!fs.existsSync(path.join(OUT, t))) err(`${f}: imagem inexistente ${src}`);
    if (!/\salt="[^"]+"/.test(m[0])) err(`${f}: imagem sem alt (${src})`);
  }
  for (const m of html.matchAll(/<a [^>]*href="([^"]+)"/g)) {
    nLinks++; const href = m[1];
    if (/^(https?:|mailto:|tel:)/.test(href)) continue;
    const [p, hash] = href.split('#'); const t = p ? path.posix.normalize(path.posix.join(dir, p)) : f;
    if (!fs.existsSync(path.join(OUT, t))) { err(`${f}: link para arquivo inexistente ${href}`); continue; }
    if (hash) { const ids = idsOf(fs.readFileSync(path.join(OUT, t), 'utf8')); if (!ids.has(hash) && !ids.has(decodeURIComponent(hash))) err(`${f}: âncora inexistente ${href}`); }
  }
}

// ---- 4. Fidelidade ao código: tabelas e eventos
const mig = fs.readdirSync('apps/server/migrations').map(n => fs.readFileSync(path.join('apps/server/migrations', n), 'utf8')).join('\n');
const codeTables = new Set([...mig.matchAll(/CREATE TABLE (?:IF NOT EXISTS )?(?:public\.)?(\w+)/gi)].map(m => m[1]));
const dict = fs.readFileSync(path.join(DOCS, 'database/data-dictionary.md'), 'utf8');
const docTables = new Set([...dict.matchAll(/^## (\w+)$/gm)].map(m => m[1]));
for (const t of codeTables) if (!docTables.has(t)) err(`tabela do código ausente do dicionário: ${t}`);
for (const t of docTables) if (!codeTables.has(t)) err(`tabela do dicionário inexistente nas migrations: ${t}`);
const ev = fs.readFileSync('packages/protocol/src/events.ts', 'utf8');
const codeEvents = new Set([...ev.matchAll(/'([a-z]+(?:\.[a-z]+)+)'/g)].map(m => m[1]));
const wsDoc = fs.readFileSync(path.join(DOCS, 'architecture/websocket.md'), 'utf8') + fs.readFileSync(path.join(DOCS, 'contracts.md'), 'utf8');
for (const e of codeEvents) if (!wsDoc.includes(e)) err(`evento do código não documentado: ${e}`);
const mentioned = new Set([...fs.readFileSync(path.join(DOCS, 'architecture/websocket.md'), 'utf8').matchAll(/`((?:queue|conversation|message|history|survey|presence|sector|internal|announcement|activity|supervisor)\.[a-z.]+)`/g)].map(m => m[1]));
for (const e of mentioned) if (!codeEvents.has(e)) err(`evento documentado inexistente no código: ${e}`);

console.log(`páginas: ${files.size} | links: ${nLinks} | imagens: ${nImgs} | tabelas: ${docTables.size}/${codeTables.size} | eventos no código: ${codeEvents.size}`);
for (const w of warns) console.log('AVISO:', w);
for (const e of errors) console.log('ERRO:', e);
console.log(errors.length ? `FALHOU (${errors.length} erro(s))` : 'OK');
process.exit(errors.length ? 1 : 0);
