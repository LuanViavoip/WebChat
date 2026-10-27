// Converte docs/**/*.md em HTML compatível com o Docs Helper, gera docs-index.json e o ZIP de importação.
// Uso: node scripts/docs/build.mjs   (a partir da raiz do repositório)
import fs from 'node:fs';
import path from 'node:path';
import MarkdownIt from 'markdown-it';
import anchor from 'markdown-it-anchor';
import { zipSync } from 'fflate';
import { SYSTEM, MODULES, DIAGRAM_TITLES, pageHtmlPath } from './pages.mjs';

const DOCS = path.resolve('docs');
const OUT = path.join(DOCS, 'docs-helper');
const HTML_DIR = path.join(OUT, 'html'), ASSETS = path.join(OUT, 'assets'), INDEX_DIR = path.join(OUT, 'index'), DIST = path.join(OUT, 'dist');
for (const d of [HTML_DIR, ASSETS]) fs.rmSync(d, { recursive: true, force: true });
for (const d of [HTML_DIR, ASSETS, INDEX_DIR, DIST]) fs.mkdirSync(d, { recursive: true });

// mapa md → caminho do html (relativo a docs/docs-helper)
const pageMap = new Map();
for (const m of MODULES) for (const p of m.pages) pageMap.set(p[0], { mod: m, page: p, html: pageHtmlPath(m, p) });

const usedAssets = new Set();
const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function render(mdPath) {
  const info = pageMap.get(mdPath);
  const src = fs.readFileSync(path.join(DOCS, mdPath), 'utf8');
  const md = new MarkdownIt({ html: false, linkify: false, typographer: false }).use(anchor, { permalink: false });
  const figures = new Set();
  const here = path.posix.dirname(info.html);
  md.core.ruler.push('rewrite', state => {
    for (const blk of state.tokens) for (const t of blk.children ?? []) {
      if (t.type === 'image') {
        const m = /rendered\/([\w-]+)\.(?:svg|png)$/.exec(t.attrGet('src'));
        if (m) { usedAssets.add(m[1]); t.attrSet('src', path.posix.relative(here, `assets/${m[1]}.png`)); }
      }
      if (t.type === 'link_open') {
        const href = t.attrGet('href');
        if (!href || /^(https?:|mailto:|tel:)/.test(href) || href.startsWith('#')) continue;
        const [file, hash] = href.split('#');
        const diagram = /rendered\/([\w-]+)\.svg$/.exec(file);
        const target = path.posix.normalize(path.posix.join(path.posix.dirname(mdPath), file));
        if (diagram) { figures.add(diagram[1]); usedAssets.add(diagram[1]); t.meta = { drop: true }; }
        else if (pageMap.has(target)) t.attrSet('href', path.posix.relative(here, pageMap.get(target).html) + (hash ? '#' + hash : ''));
        else t.meta = { drop: true };
      }
    }
  });
  // links sem destino no pacote viram texto (remove <a> mantendo o conteúdo)
  const defaultOpen = md.renderer.rules.link_open ?? ((tk, i, o, e, s) => s.renderToken(tk, i, o));
  const defaultClose = md.renderer.rules.link_close ?? ((tk, i, o, e, s) => s.renderToken(tk, i, o));
  let dropStack = [];
  md.renderer.rules.link_open = (tk, i, o, e, s) => { const d = !!tk[i].meta?.drop; dropStack.push(d); return d ? '' : defaultOpen(tk, i, o, e, s); };
  md.renderer.rules.link_close = (tk, i, o, e, s) => (dropStack.pop() ? '' : defaultClose(tk, i, o, e, s));
  // credencial de demonstração do seed local: nunca vai para o pacote do Docs Helper
  let body = md.render(src).replaceAll('demo-pass-123', '&lt;senha-de-demonstração&gt;');
  if (figures.size) {
    body += `<section id="diagramas-referenciados"><h2>Diagramas referenciados</h2>\n` +
      [...figures].map(n => `<figure><img src="${path.posix.relative(here, `assets/${n}.png`)}" alt="${esc(DIAGRAM_TITLES[n] ?? n)}"><figcaption>${esc(DIAGRAM_TITLES[n] ?? n)}</figcaption></figure>`).join('\n') + `\n</section>\n`;
  }
  const title = info.page[1];
  return `<!doctype html>\n<html lang="pt-BR">\n<head>\n<meta charset="utf-8">\n<title>${esc(title)} — ViaVoip Webchat</title>\n</head>\n<body>\n<article>\n${body}</article>\n</body>\n</html>\n`;
}

for (const [mdPath, info] of pageMap) {
  const out = path.join(OUT, info.html);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, render(mdPath));
}
for (const n of usedAssets) {
  const png = path.join(DOCS, 'diagrams/rendered', `${n}.png`);
  if (!fs.existsSync(png)) throw new Error(`PNG ausente: ${png} (rode scripts/docs/render-diagrams.sh)`);
  fs.copyFileSync(png, path.join(ASSETS, `${n}.png`));
}

const index = {
  system: SYSTEM,
  documents: MODULES.map(m => ({
    title: m.title, slug: m.slug, type: 'module',
    children: m.pages.map(p => ({ title: p[1], slug: p[2], type: 'page', file: pageHtmlPath(m, p) })),
  })),
};
const indexJson = JSON.stringify(index, null, 2) + '\n';
fs.writeFileSync(path.join(INDEX_DIR, 'docs-index.json'), indexJson);

// ZIP reproduzível: docs-index.json na raiz + html/ + assets/
const files = { 'docs-index.json': [new TextEncoder().encode(indexJson), { mtime: new Date('2026-01-01T00:00:00Z') }] };
const walk = d => fs.readdirSync(d, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]);
for (const f of [...walk(HTML_DIR), ...walk(ASSETS)].sort())
  files[path.relative(OUT, f).split(path.sep).join('/')] = [fs.readFileSync(f), { mtime: new Date('2026-01-01T00:00:00Z') }];
const zip = zipSync(files, { level: 6 });
fs.writeFileSync(path.join(DIST, 'viavoip-webchat-docs.zip'), zip);
console.log(`ok: ${pageMap.size} páginas, ${usedAssets.size} imagens, zip ${(zip.length / 1024).toFixed(0)} KiB`);
