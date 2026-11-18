#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const BUMP_BEGIN = '/* @bump-begin */';
const BUMP_END = '/* @bump-end */';

const SERIES_RE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const BUILD_NUM_RE = /^[1-9]\d*$/;
const VERSION_RE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.([1-9]\d*)$/;
const DATE_RE = /^(\d{2})\/(\d{2})\/(\d{4})$/;

const SECTION_HEADER_RE =
  /^## 📦 Histórico de Alterações — Série `([^`]+)` \(`([^`]+)` a `([^`]+)`\)$/;
const BUILD_HEADER_RE = /^### Build `([^`]+)` — \*([^*]+)\*$/;
const HEADER_VERSION_RE = /^>\s*\*\*Versão Atual de Compilação:\*\*\s*`([^`]+)`\s*$/;
const HEADER_BASE_RE = /^>\s*\*\*Série Base Atual:\*\*\s*`([^`]+)`\s*$/;
const HEADER_DATE_RE = /^>\s*\*\*Última Atualização:\*\*\s*`([^`]+)`\s*$/;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const appRoot = path.resolve(__dirname, '..');
const versionTsPath = path.join(appRoot, 'src', 'version.ts');
const releaseNotesPath = path.join(appRoot, 'RELEASE_NOTES.md');

class CliError extends Error {
  constructor(message) {
    super(message);
    this.name = 'CliError';
  }
}

function printUsage() {
  const lines = [
    'Uso:',
    '  node scripts/bump-version.mjs "<Título>" "<Detalhe 1>" ["<Detalhe 2>" ...]',
    '  node scripts/bump-version.mjs --remix <X.Y> "<Título>" "<Detalhe 1>" [...]',
    '  node scripts/bump-version.mjs --from-pending <arquivo.json>',
    '  node scripts/bump-version.mjs --check',
    '',
    'Opções:',
    '  --dry-run   Mostra as alterações planejadas no stdout sem gravar nem apagar arquivos.',
    '  --help, -h  Exibe esta ajuda.',
  ];
  process.stdout.write(`${lines.join('\n')}\n`);
}

function getTodaySaoPaulo() {
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(new Date());
}

function parseSeries(raw, label) {
  if (typeof raw !== 'string') {
    throw new CliError(`${label} deve ser uma string no formato <MAJOR>.<MINOR>.`);
  }
  const match = SERIES_RE.exec(raw);
  if (!match) {
    throw new CliError(
      `${label} inválido ("${raw}"): esperado formato <MAJOR>.<MINOR> sem zeros à esquerda.`,
    );
  }
  return {
    raw,
    major: Number(match[1]),
    minor: Number(match[2]),
  };
}

function compareSeries(a, b) {
  if (a.major !== b.major) {
    return a.major - b.major;
  }
  return a.minor - b.minor;
}

function parseVersion(raw, label) {
  if (typeof raw !== 'string') {
    throw new CliError(`${label} deve ser uma string no formato <MAJOR>.<MINOR>.<BUILD>.`);
  }
  const match = VERSION_RE.exec(raw);
  if (!match) {
    throw new CliError(
      `${label} inválido ("${raw}"): esperado <MAJOR>.<MINOR>.<BUILD> sem zeros à esquerda e sem build .0.`,
    );
  }
  return {
    raw,
    major: Number(match[1]),
    minor: Number(match[2]),
    build: Number(match[3]),
    series: `${match[1]}.${match[2]}`,
  };
}

function parseStrictDate(raw, label) {
  if (typeof raw !== 'string') {
    throw new CliError(`${label} deve ser uma string no formato DD/MM/AAAA.`);
  }
  const match = DATE_RE.exec(raw);
  if (!match) {
    throw new CliError(`${label} inválido ("${raw}"): esperado formato DD/MM/AAAA.`);
  }
  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = Number(match[3]);
  if (year < 1000 || month < 1 || month > 12 || day < 1 || day > 31) {
    throw new CliError(`${label} contém data inválida ("${raw}").`);
  }
  const dt = new Date(Date.UTC(year, month - 1, day));
  if (
    dt.getUTCFullYear() !== year ||
    dt.getUTCMonth() !== month - 1 ||
    dt.getUTCDate() !== day
  ) {
    throw new CliError(`${label} não existe no calendário ("${raw}").`);
  }
  return year * 10000 + month * 100 + day;
}

function validateEntryText(raw, label, { requireAlreadyTrimmed = false } = {}) {
  if (typeof raw !== 'string') {
    throw new CliError(`${label} deve ser uma string.`);
  }
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    throw new CliError(`${label} não pode ser vazio.`);
  }
  if (requireAlreadyTrimmed && trimmed !== raw) {
    throw new CliError(`${label} não deve conter espaços extras nas extremidades.`);
  }
  if (/[\r\n]/.test(trimmed)) {
    throw new CliError(`${label} deve ocupar uma única linha (sem quebras de linha).`);
  }
  if (trimmed.includes(BUMP_BEGIN) || trimmed.includes(BUMP_END)) {
    throw new CliError(`${label} não pode conter marcadores @bump-begin/@bump-end.`);
  }
  return trimmed;
}

function countOccurrences(haystack, needle) {
  let count = 0;
  let pos = 0;
  while (true) {
    const idx = haystack.indexOf(needle, pos);
    if (idx === -1) {
      return count;
    }
    count += 1;
    pos = idx + needle.length;
  }
}

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validateHistoryEntries(history) {
  if (!Array.isArray(history) || history.length === 0) {
    throw new CliError('RELEASE_NOTES_HISTORY em src/version.ts deve ser um array não vazio.');
  }

  let prevSeries = null;
  let prevBuild = null;
  let newerDateKey = null;
  const seenSeries = new Set();

  for (let i = 0; i < history.length; i += 1) {
    const entry = history[i];
    const prefix = `RELEASE_NOTES_HISTORY[${i}]`;
    if (!isPlainObject(entry)) {
      throw new CliError(`${prefix} deve ser um objeto.`);
    }

    const parsedVersion = parseVersion(entry.version, `${prefix}.version`);
    const dateKey = parseStrictDate(entry.date, `${prefix}.date`);
    validateEntryText(entry.title, `${prefix}.title`, { requireAlreadyTrimmed: true });

    if (!Array.isArray(entry.details) || entry.details.length === 0) {
      throw new CliError(`${prefix}.details deve ser um array não vazio.`);
    }
    for (let j = 0; j < entry.details.length; j += 1) {
      validateEntryText(entry.details[j], `${prefix}.details[${j}]`, {
        requireAlreadyTrimmed: true,
      });
    }

    if (newerDateKey !== null && dateKey > newerDateKey) {
      throw new CliError(
        `Ordem cronológica inválida em RELEASE_NOTES_HISTORY: "${entry.version}" (${entry.date}) é mais recente que "${history[i - 1].version}" (${history[i - 1].date}).`,
      );
    }
    newerDateKey = dateKey;

    if (prevSeries === null) {
      seenSeries.add(parsedVersion.series);
      prevSeries = parseSeries(parsedVersion.series, `${prefix}.version (série)`);
      prevBuild = parsedVersion.build;
    } else if (parsedVersion.series === prevSeries.raw) {
      if (parsedVersion.build !== prevBuild - 1) {
        throw new CliError(
          `Builds fora de sequência na série "${parsedVersion.series}" em RELEASE_NOTES_HISTORY: esperado "${parsedVersion.series}.${prevBuild - 1}", encontrado "${entry.version}".`,
        );
      }
      prevBuild = parsedVersion.build;
    } else {
      if (prevBuild !== 1) {
        throw new CliError(
          `Série "${prevSeries.raw}" em RELEASE_NOTES_HISTORY não termina no build 1 (último encontrado: "${prevSeries.raw}.${prevBuild}").`,
        );
      }
      const currSeries = parseSeries(parsedVersion.series, `${prefix}.version (série)`);
      if (seenSeries.has(parsedVersion.series) || compareSeries(currSeries, prevSeries) >= 0) {
        throw new CliError(
          `Ordem de séries inválida em RELEASE_NOTES_HISTORY: série "${parsedVersion.series}" deve ser estritamente menor que "${prevSeries.raw}".`,
        );
      }
      seenSeries.add(parsedVersion.series);
      prevSeries = currSeries;
      prevBuild = parsedVersion.build;
    }
  }

  if (prevBuild !== 1) {
    throw new CliError(
      `Série "${prevSeries.raw}" em RELEASE_NOTES_HISTORY não termina no build 1 (último encontrado: "${prevSeries.raw}.${prevBuild}").`,
    );
  }
}

function parseAndValidateVersionTs(rawContent) {
  const content = rawContent.replace(/\r\n/g, '\n');

  const baseMatches = [...content.matchAll(/^export\s+const\s+APP_BASE_VERSION\s*=\s*(['"])([^'"]*)\1\s*;\s*$/gm)];
  if (baseMatches.length !== 1) {
    throw new CliError('src/version.ts deve definir exatamente uma export const APP_BASE_VERSION.');
  }
  const baseVersion = parseSeries(baseMatches[0][2], 'APP_BASE_VERSION');

  const buildMatches = [...content.matchAll(/^export\s+const\s+APP_BUILD_NUMBER\s*=\s*([^;\n]+);\s*$/gm)];
  if (buildMatches.length !== 1) {
    throw new CliError('src/version.ts deve definir exatamente uma export const APP_BUILD_NUMBER.');
  }
  const buildRaw = buildMatches[0][1].trim();
  if (!BUILD_NUM_RE.test(buildRaw)) {
    throw new CliError(
      `APP_BUILD_NUMBER inválido ("${buildRaw}"): esperado inteiro >= 1 sem zeros à esquerda.`,
    );
  }
  const buildNumber = Number(buildRaw);
  const appVersion = `${baseVersion.raw}.${buildNumber}`;

  const appVersionMatches = [...content.matchAll(/^export\s+const\s+APP_VERSION\s*=\s*([^;\n]+);\s*$/gm)];
  if (appVersionMatches.length !== 1) {
    throw new CliError('src/version.ts deve definir exatamente uma export const APP_VERSION.');
  }
  const appVersionRhs = appVersionMatches[0][1].trim();
  const expectedTemplates = new Set([
    '`${APP_BASE_VERSION}.${APP_BUILD_NUMBER}`',
    '`${APP_BASE_VERSION}.${String(APP_BUILD_NUMBER)}`',
  ]);
  if (
    !expectedTemplates.has(appVersionRhs) &&
    appVersionRhs !== `'${appVersion}'` &&
    appVersionRhs !== `"${appVersion}"`
  ) {
    throw new CliError(
      `APP_VERSION em src/version.ts ("${appVersionRhs}") não corresponde a \`\${APP_BASE_VERSION}.\${String(APP_BUILD_NUMBER)}\` nem a "${appVersion}".`,
    );
  }

  if (countOccurrences(content, BUMP_BEGIN) !== 1 || countOccurrences(content, BUMP_END) !== 1) {
    throw new CliError('src/version.ts deve conter exatamente um marcador /* @bump-begin */ e um /* @bump-end */.');
  }
  const beginIdx = content.indexOf(BUMP_BEGIN);
  const endIdx = content.indexOf(BUMP_END);
  if (beginIdx >= endIdx) {
    throw new CliError('Marcador /* @bump-begin */ deve aparecer antes de /* @bump-end */ em src/version.ts.');
  }

  const jsonText = content.slice(beginIdx + BUMP_BEGIN.length, endIdx);
  let history;
  try {
    history = JSON.parse(jsonText);
  } catch (err) {
    throw new CliError(
      `JSON inválido entre /* @bump-begin */ e /* @bump-end */ em src/version.ts: ${err.message}`,
    );
  }

  validateHistoryEntries(history);

  if (history[0].version !== appVersion) {
    throw new CliError(
      `RELEASE_NOTES_HISTORY[0].version ("${history[0].version}") difere de APP_VERSION ("${appVersion}").`,
    );
  }

  return {
    content,
    baseVersion,
    buildNumber,
    appVersion,
    history,
  };
}

function extractSingleHeaderField(lines, regex, label) {
  const matches = [];
  for (const line of lines) {
    const m = regex.exec(line);
    if (m) {
      matches.push(m[1]);
    }
  }
  if (matches.length !== 1) {
    throw new CliError(`Cabeçalho "${label}" deve aparecer exatamente uma vez em RELEASE_NOTES.md.`);
  }
  return matches[0];
}

function flushBuildBlock(currentSection, currentBuild, lineNo) {
  if (!currentBuild) {
    return;
  }
  if (currentBuild.title === null) {
    throw new CliError(
      `Bloco ### Build \`${currentBuild.version.raw}\` sem linha de título **...** antes da linha ${lineNo} em RELEASE_NOTES.md.`,
    );
  }
  if (currentBuild.details.length === 0) {
    throw new CliError(
      `Bloco ### Build \`${currentBuild.version.raw}\` sem itens de detalhe (- ...) antes da linha ${lineNo} em RELEASE_NOTES.md.`,
    );
  }
  currentSection.builds.push(currentBuild);
}

function parseAndValidateReleaseNotes(rawContent, versionState) {
  const content = rawContent.replace(/\r\n/g, '\n');
  const lines = content.split('\n');

  const firstSectionIdx = lines.findIndex((line) => line.startsWith('## 📦 Histórico de Alterações'));
  if (firstSectionIdx === -1) {
    throw new CliError(
      'Nenhuma seção "## 📦 Histórico de Alterações — Série ..." encontrada em RELEASE_NOTES.md.',
    );
  }

  const preambleLines = lines.slice(0, firstSectionIdx);
  for (let i = 0; i < preambleLines.length; i += 1) {
    if (preambleLines[i].startsWith('### Build')) {
      throw new CliError(
        `Bloco "### Build" encontrado antes da primeira seção de histórico (linha ${i + 1}) em RELEASE_NOTES.md.`,
      );
    }
    if (/^##\s+Hist[oó]rico/i.test(preambleLines[i])) {
      throw new CliError(
        `Cabeçalho de seção malformado na linha ${i + 1} de RELEASE_NOTES.md: "${preambleLines[i]}".`,
      );
    }
  }

  const headerVersion = extractSingleHeaderField(
    preambleLines,
    HEADER_VERSION_RE,
    'Versão Atual de Compilação',
  );
  const headerBase = extractSingleHeaderField(
    preambleLines,
    HEADER_BASE_RE,
    'Série Base Atual',
  );
  const headerDate = extractSingleHeaderField(
    preambleLines,
    HEADER_DATE_RE,
    'Última Atualização',
  );

  parseVersion(headerVersion, 'Cabeçalho Versão Atual de Compilação');
  parseSeries(headerBase, 'Cabeçalho Série Base Atual');
  parseStrictDate(headerDate, 'Cabeçalho Última Atualização');

  if (headerVersion !== versionState.appVersion) {
    throw new CliError(
      `Cabeçalho Versão Atual de Compilação ("${headerVersion}") difere de APP_VERSION ("${versionState.appVersion}").`,
    );
  }
  if (headerBase !== versionState.baseVersion.raw) {
    throw new CliError(
      `Cabeçalho Série Base Atual ("${headerBase}") difere de APP_BASE_VERSION ("${versionState.baseVersion.raw}").`,
    );
  }
  if (headerDate !== versionState.history[0].date) {
    throw new CliError(
      `Cabeçalho Última Atualização ("${headerDate}") difere de RELEASE_NOTES_HISTORY[0].date ("${versionState.history[0].date}").`,
    );
  }

  const sections = [];
  let currentSection = null;
  let currentBuild = null;
  let sawSeparator = false;

  for (let idx = firstSectionIdx; idx < lines.length; idx += 1) {
    const line = lines[idx];
    const lineNo = idx + 1;

    if (line.trim() === '') {
      if (currentBuild) {
        flushBuildBlock(currentSection, currentBuild, lineNo);
        currentBuild = null;
      }
      continue;
    }

    if (line.trim() === '---') {
      if (currentBuild) {
        flushBuildBlock(currentSection, currentBuild, lineNo);
        currentBuild = null;
      }
      if (!currentSection) {
        throw new CliError(`Separador "---" inesperado na linha ${lineNo} de RELEASE_NOTES.md.`);
      }
      if (sawSeparator) {
        throw new CliError(`Separador "---" duplicado na linha ${lineNo} de RELEASE_NOTES.md.`);
      }
      sawSeparator = true;
      continue;
    }

    if (line.startsWith('## ')) {
      if (currentBuild) {
        flushBuildBlock(currentSection, currentBuild, lineNo);
        currentBuild = null;
      }
      const match = SECTION_HEADER_RE.exec(line);
      if (!match) {
        throw new CliError(
          `Cabeçalho de seção inválido na linha ${lineNo} de RELEASE_NOTES.md: "${line}".`,
        );
      }
      const series = parseSeries(match[1], `Seção linha ${lineNo} (Série)`);
      const rangeStart = parseVersion(match[2], `Seção linha ${lineNo} (início da faixa)`);
      const rangeEnd = parseVersion(match[3], `Seção linha ${lineNo} (fim da faixa)`);

      if (rangeStart.series !== series.raw || rangeStart.build !== 1) {
        throw new CliError(
          `Faixa inicial inválida na seção "${series.raw}" (linha ${lineNo}): esperado "${series.raw}.1", encontrado "${rangeStart.raw}".`,
        );
      }
      if (rangeEnd.series !== series.raw) {
        throw new CliError(
          `Faixa final "${rangeEnd.raw}" não pertence à série "${series.raw}" (linha ${lineNo}).`,
        );
      }
      if (currentSection !== null && compareSeries(series, currentSection.series) >= 0) {
        throw new CliError(
          `Séries fora de ordem decrescente estrita em RELEASE_NOTES.md (linha ${lineNo}): "${series.raw}" deve ser menor que "${currentSection.series.raw}".`,
        );
      }

      sawSeparator = false;
      currentSection = {
        series,
        rangeStart,
        rangeEnd,
        builds: [],
      };
      sections.push(currentSection);
      continue;
    }

    if (line.startsWith('### ')) {
      if (sawSeparator) {
        throw new CliError(
          `Separador "---" inesperado antes do build na linha ${lineNo} de RELEASE_NOTES.md.`,
        );
      }
      if (currentBuild) {
        flushBuildBlock(currentSection, currentBuild, lineNo);
        currentBuild = null;
      }
      const match = BUILD_HEADER_RE.exec(line);
      if (!match) {
        throw new CliError(
          `Cabeçalho de build inválido na linha ${lineNo} de RELEASE_NOTES.md: "${line}".`,
        );
      }
      const version = parseVersion(match[1], `Build linha ${lineNo}`);
      parseStrictDate(match[2], `Data do build "${version.raw}" (linha ${lineNo})`);
      if (version.series !== currentSection.series.raw) {
        throw new CliError(
          `Build "${version.raw}" (linha ${lineNo}) não pertence à seção da série "${currentSection.series.raw}".`,
        );
      }
      currentBuild = {
        version,
        date: match[2],
        title: null,
        details: [],
      };
      continue;
    }

    if (currentBuild !== null && currentBuild.title === null) {
      const titleMatch = /^\*\*(.+)\*\*$/.exec(line);
      if (!titleMatch || titleMatch[1].trim() === '' || titleMatch[1].trim() !== titleMatch[1]) {
        throw new CliError(
          `Esperada linha de título "**Título**" na linha ${lineNo} de RELEASE_NOTES.md.`,
        );
      }
      currentBuild.title = titleMatch[1];
      continue;
    }

    if (currentBuild !== null && currentBuild.title !== null) {
      const detailMatch = /^- (.+)$/.exec(line);
      if (!detailMatch || detailMatch[1].trim() === '' || detailMatch[1].trim() !== detailMatch[1]) {
        throw new CliError(
          `Esperado item de detalhe "- ..." na linha ${lineNo} de RELEASE_NOTES.md, encontrado: "${line}".`,
        );
      }
      currentBuild.details.push(detailMatch[1]);
      continue;
    }

    throw new CliError(`Conteúdo inesperado na linha ${lineNo} de RELEASE_NOTES.md: "${line}".`);
  }

  if (sawSeparator) {
    throw new CliError('Separador "---" sem seção seguinte no final de RELEASE_NOTES.md.');
  }
  if (currentBuild) {
    flushBuildBlock(currentSection, currentBuild, lines.length + 1);
  }

  const mdBuilds = [];
  for (const section of sections) {
    if (section.builds.length === 0) {
      throw new CliError(`Seção da série "${section.series.raw}" em RELEASE_NOTES.md não possui builds.`);
    }
    const maxExpected = section.rangeEnd.build;
    if (section.builds[0].version.build !== maxExpected) {
      throw new CliError(
        `Primeiro build da série "${section.series.raw}" em RELEASE_NOTES.md é "${section.builds[0].version.raw}", mas a faixa declara até "${section.rangeEnd.raw}".`,
      );
    }
    let expectedBuild = maxExpected;
    for (const build of section.builds) {
      if (build.version.build !== expectedBuild) {
        throw new CliError(
          `Lacuna ou ordem inválida na série "${section.series.raw}" em RELEASE_NOTES.md: esperado "${section.series.raw}.${expectedBuild}", encontrado "${build.version.raw}".`,
        );
      }
      mdBuilds.push(build);
      expectedBuild -= 1;
    }
    if (expectedBuild !== 0) {
      throw new CliError(
        `Série "${section.series.raw}" em RELEASE_NOTES.md não termina no build 1 (terminou em "${section.series.raw}.${expectedBuild + 1}").`,
      );
    }
  }

  if (mdBuilds.length === 0 || mdBuilds[0].version.raw !== versionState.appVersion) {
    throw new CliError(
      `Primeiro ### Build de RELEASE_NOTES.md ("${mdBuilds[0]?.version.raw ?? 'nenhum'}") difere de APP_VERSION ("${versionState.appVersion}").`,
    );
  }

  if (mdBuilds.length !== versionState.history.length) {
    throw new CliError(
      `Quantidade de builds diverge entre RELEASE_NOTES.md (${mdBuilds.length}) e RELEASE_NOTES_HISTORY (${versionState.history.length}).`,
    );
  }

  for (let i = 0; i < versionState.history.length; i += 1) {
    const mdEntry = mdBuilds[i];
    const tsEntry = versionState.history[i];
    if (mdEntry.version.raw !== tsEntry.version) {
      throw new CliError(
        `Divergência de versão no índice ${i}: RELEASE_NOTES.md tem "${mdEntry.version.raw}", version.ts tem "${tsEntry.version}".`,
      );
    }
    if (mdEntry.date !== tsEntry.date) {
      throw new CliError(
        `Divergência de data no build "${tsEntry.version}": RELEASE_NOTES.md tem "${mdEntry.date}", version.ts tem "${tsEntry.date}".`,
      );
    }
    if (mdEntry.title !== tsEntry.title) {
      throw new CliError(
        `Divergência de título no build "${tsEntry.version}": RELEASE_NOTES.md difere de version.ts.`,
      );
    }
    if (
      mdEntry.details.length !== tsEntry.details.length ||
      mdEntry.details.some((item, j) => item !== tsEntry.details[j])
    ) {
      throw new CliError(
        `Divergência nos detalhes do build "${tsEntry.version}" entre RELEASE_NOTES.md e version.ts.`,
      );
    }
  }

  return {
    preambleLines,
    sections,
  };
}

function readAndValidateCurrentState() {
  let rawVersionTs;
  try {
    rawVersionTs = fs.readFileSync(versionTsPath, 'utf8');
  } catch (err) {
    throw new CliError(`Não foi possível ler ${versionTsPath}: ${err.message}`);
  }

  let rawReleaseNotes;
  try {
    rawReleaseNotes = fs.readFileSync(releaseNotesPath, 'utf8');
  } catch (err) {
    throw new CliError(`Não foi possível ler ${releaseNotesPath}: ${err.message}`);
  }

  const versionState = parseAndValidateVersionTs(rawVersionTs);
  const notesState = parseAndValidateReleaseNotes(rawReleaseNotes, versionState);

  return {
    versionState,
    notesState,
  };
}

function buildUpdatedVersionTs(currentContent, newBaseVersion, newBuildNumber, newHistory) {
  let updated = currentContent.replace(
    /^(export\s+const\s+APP_BASE_VERSION\s*=\s*)(['"])[^'"]*\2(\s*;\s*)$/m,
    (_full, prefix, _quote, suffix) => `${prefix}'${newBaseVersion}'${suffix}`,
  );

  updated = updated.replace(
    /^(export\s+const\s+APP_BUILD_NUMBER\s*=\s*)[^;\n]+(;\s*)$/m,
    (_full, prefix, suffix) => `${prefix}${newBuildNumber}${suffix}`,
  );

  const beginIdx = updated.indexOf(BUMP_BEGIN);
  const endIdx = updated.indexOf(BUMP_END);
  const serializedHistory = JSON.stringify(newHistory, null, 2);

  return `${updated.slice(0, beginIdx + BUMP_BEGIN.length)} ${serializedHistory} ${updated.slice(endIdx)}`;
}

function formatBuildBlock(entry) {
  return [
    `### Build \`${entry.version}\` — *${entry.date}*`,
    `**${entry.title}**`,
    ...entry.details.map((detail) => `- ${detail}`),
  ].join('\n');
}

function formatSeriesSection(series, entries) {
  const newestVersion = entries[0].version;
  const oldestVersion = entries[entries.length - 1].version;
  const header = `## 📦 Histórico de Alterações — Série \`${series}\` (\`${oldestVersion}\` a \`${newestVersion}\`)`;
  const blocks = entries.map(formatBuildBlock).join('\n\n');
  return `${header}\n\n${blocks}`;
}

function buildUpdatedReleaseNotes(preambleLines, newBaseVersion, newVersion, latestDate, newHistory) {
  const updatedPreambleLines = preambleLines.map((line) => {
    if (HEADER_VERSION_RE.test(line)) {
      return `> **Versão Atual de Compilação:** \`${newVersion}\`  `;
    }
    if (HEADER_BASE_RE.test(line)) {
      return `> **Série Base Atual:** \`${newBaseVersion}\`  `;
    }
    if (HEADER_DATE_RE.test(line)) {
      return `> **Última Atualização:** \`${latestDate}\``;
    }
    return line;
  });

  const groups = [];
  for (const entry of newHistory) {
    const parsed = parseVersion(entry.version, 'build');
    const lastGroup = groups[groups.length - 1];
    if (lastGroup && lastGroup.series === parsed.series) {
      lastGroup.entries.push(entry);
    } else {
      groups.push({ series: parsed.series, entries: [entry] });
    }
  }

  const sectionsText = groups
    .map((group) => formatSeriesSection(group.series, group.entries))
    .join('\n\n---\n\n');

  while (
    updatedPreambleLines.length > 0 &&
    updatedPreambleLines[updatedPreambleLines.length - 1] === ''
  ) {
    updatedPreambleLines.pop();
  }
  const preambleText = updatedPreambleLines.join('\n');
  return `${preambleText}\n\n${sectionsText}\n`;
}

function loadAndValidatePendingFile(rawPath) {
  const resolvedPath = path.resolve(process.cwd(), rawPath);
  let rawJson;
  try {
    rawJson = fs.readFileSync(resolvedPath, 'utf8');
  } catch (err) {
    throw new CliError(`Não foi possível ler arquivo pendente "${resolvedPath}": ${err.message}`);
  }

  let parsed;
  try {
    parsed = JSON.parse(rawJson);
  } catch (err) {
    throw new CliError(`JSON inválido no arquivo pendente "${resolvedPath}": ${err.message}`);
  }

  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new CliError(
      `Arquivo pendente "${resolvedPath}" deve conter um array JSON não vazio de { title, details }.`,
    );
  }

  const normalized = parsed.map((item, idx) => {
    if (!isPlainObject(item)) {
      throw new CliError(`Item [${idx}] de "${resolvedPath}" deve ser um objeto { title, details }.`);
    }
    const title = validateEntryText(item.title, `${rawPath}[${idx}].title`);
    if (!Array.isArray(item.details) || item.details.length === 0) {
      throw new CliError(`${rawPath}[${idx}].details deve ser um array não vazio de strings.`);
    }
    const details = item.details.map((detail, detailIdx) =>
      validateEntryText(detail, `${rawPath}[${idx}].details[${detailIdx}]`),
    );
    return { title, details };
  });

  return {
    resolvedPath,
    entries: normalized,
  };
}

function writeFilesAtomically(originalVersionContent, nextVersionContent, nextNotesContent) {
  const suffix = `${process.pid}-${Date.now()}`;
  const versionTmpPath = path.join(path.dirname(versionTsPath), `.version.ts.tmp-${suffix}`);
  const notesTmpPath = path.join(path.dirname(releaseNotesPath), `.RELEASE_NOTES.md.tmp-${suffix}`);

  try {
    fs.writeFileSync(versionTmpPath, nextVersionContent, 'utf8');
    fs.writeFileSync(notesTmpPath, nextNotesContent, 'utf8');
  } catch (err) {
    fs.rmSync(versionTmpPath, { force: true });
    fs.rmSync(notesTmpPath, { force: true });
    throw new CliError(`Falha ao gravar arquivos temporários: ${err.message}`);
  }

  try {
    fs.renameSync(versionTmpPath, versionTsPath);
  } catch (err) {
    fs.rmSync(versionTmpPath, { force: true });
    fs.rmSync(notesTmpPath, { force: true });
    throw new CliError(`Falha ao atualizar ${versionTsPath}: ${err.message}`);
  }

  try {
    fs.renameSync(notesTmpPath, releaseNotesPath);
  } catch (err) {
    fs.rmSync(notesTmpPath, { force: true });
    const rollbackTmpPath = path.join(
      path.dirname(versionTsPath),
      `.version.ts.rollback-${suffix}`,
    );
    let rollbackDetail = 'rollback aplicado com sucesso';
    try {
      fs.writeFileSync(rollbackTmpPath, originalVersionContent, 'utf8');
      fs.renameSync(rollbackTmpPath, versionTsPath);
    } catch (rollbackErr) {
      fs.rmSync(rollbackTmpPath, { force: true });
      rollbackDetail = `ATENÇÃO: falha no rollback de ${versionTsPath}: ${rollbackErr.message}`;
    }
    throw new CliError(
      `Falha ao atualizar ${releaseNotesPath} (${err.message}); ${rollbackDetail}.`,
    );
  }
}

function parseCliArgs(argv) {
  let check = false;
  let dryRun = false;
  let help = false;
  let remixSeries = null;
  let fromPendingPath = null;
  let endOfOptions = false;
  const positional = [];

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (endOfOptions) {
      positional.push(arg);
      continue;
    }
    if (arg === '--') {
      endOfOptions = true;
      continue;
    }
    if (arg === '--help' || arg === '-h') {
      help = true;
      continue;
    }
    if (arg === '--check') {
      check = true;
      continue;
    }
    if (arg === '--dry-run') {
      dryRun = true;
      continue;
    }
    if (arg === '--remix' || arg.startsWith('--remix=')) {
      if (remixSeries !== null) {
        throw new CliError('Opção --remix informada mais de uma vez.');
      }
      const value = arg === '--remix' ? argv[++i] : arg.slice('--remix='.length);
      if (value === undefined) {
        throw new CliError('Opção --remix requer um valor <X.Y>.');
      }
      remixSeries = value;
      continue;
    }
    if (arg === '--from-pending' || arg.startsWith('--from-pending=')) {
      if (fromPendingPath !== null) {
        throw new CliError('Opção --from-pending informada mais de uma vez.');
      }
      const value = arg === '--from-pending' ? argv[++i] : arg.slice('--from-pending='.length);
      if (value === undefined || value.trim() === '') {
        throw new CliError('Opção --from-pending requer o caminho de um arquivo JSON.');
      }
      fromPendingPath = value;
      continue;
    }
    if (arg.startsWith('-')) {
      throw new CliError(`Opção desconhecida: "${arg}". Use --help para ver os modos válidos.`);
    }
    positional.push(arg);
  }

  if (help) {
    return { mode: 'help' };
  }

  if (check) {
    if (dryRun || remixSeries !== null || fromPendingPath !== null || positional.length > 0) {
      throw new CliError('--check não aceita outras opções ou argumentos posicionais.');
    }
    return { mode: 'check' };
  }

  if (remixSeries !== null && fromPendingPath !== null) {
    throw new CliError('--remix e --from-pending não podem ser usados juntos.');
  }

  if (fromPendingPath !== null) {
    if (positional.length > 0) {
      throw new CliError('--from-pending não aceita argumentos posicionais de título/detalhes.');
    }
    return {
      mode: 'from-pending',
      dryRun,
      pendingFile: fromPendingPath,
    };
  }

  if (positional.length === 0) {
    throw new CliError(
      'Informe "<Título>" e pelo menos um "<Detalhe>", ou use --check / --from-pending. Use --help para ajuda.',
    );
  }
  if (positional.length < 2) {
    throw new CliError('É obrigatório informar pelo menos 1 detalhe além do título.');
  }

  const title = validateEntryText(positional[0], 'Título');
  const details = positional
    .slice(1)
    .map((item, idx) => validateEntryText(item, `Detalhe ${idx + 1}`));

  if (remixSeries !== null) {
    return {
      mode: 'remix',
      dryRun,
      remixSeries,
      title,
      details,
    };
  }

  return {
    mode: 'bump',
    dryRun,
    title,
    details,
  };
}

function planUpdates(command, currentState) {
  const { versionState, notesState } = currentState;
  const today = getTodaySaoPaulo();
  let targetBase = versionState.baseVersion;
  let nextBuild = versionState.buildNumber;
  const plannedEntries = [];

  if (command.mode === 'remix') {
    const requested = parseSeries(command.remixSeries, 'Série --remix');
    if (compareSeries(requested, versionState.baseVersion) <= 0) {
      throw new CliError(
        `Série --remix ("${requested.raw}") deve ser estritamente maior que a série atual ("${versionState.baseVersion.raw}").`,
      );
    }
    targetBase = requested;
    nextBuild = 1;
    plannedEntries.push({
      version: `${targetBase.raw}.1`,
      date: today,
      title: command.title,
      details: command.details,
    });
  } else if (command.mode === 'bump') {
    nextBuild += 1;
    plannedEntries.push({
      version: `${targetBase.raw}.${nextBuild}`,
      date: today,
      title: command.title,
      details: command.details,
    });
  } else if (command.mode === 'from-pending') {
    const pending = loadAndValidatePendingFile(command.pendingFile);
    for (const item of pending.entries) {
      nextBuild += 1;
      plannedEntries.push({
        version: `${targetBase.raw}.${nextBuild}`,
        date: today,
        title: item.title,
        details: item.details,
      });
    }
    command.resolvedPendingPath = pending.resolvedPath;
  }

  // Entries are applied oldest-to-newest, while history is stored newest-to-oldest.
  const prependedNewestFirst = [...plannedEntries].reverse();
  const nextHistory = [...prependedNewestFirst, ...versionState.history];
  const nextVersion = `${targetBase.raw}.${nextBuild}`;

  const nextVersionTsContent = buildUpdatedVersionTs(
    versionState.content,
    targetBase.raw,
    nextBuild,
    nextHistory,
  );
  const nextReleaseNotesContent = buildUpdatedReleaseNotes(
    notesState.preambleLines,
    targetBase.raw,
    nextVersion,
    today,
    nextHistory,
  );

  // Re-validate planned output before touching disk (e.g. catches chronological regressions).
  const validatedNextVersion = parseAndValidateVersionTs(nextVersionTsContent);
  parseAndValidateReleaseNotes(nextReleaseNotesContent, validatedNextVersion);

  return {
    previousVersion: versionState.appVersion,
    previousBase: versionState.baseVersion.raw,
    nextBase: targetBase.raw,
    nextVersion,
    plannedEntries,
    prependedNewestFirst,
    nextVersionTsContent,
    nextReleaseNotesContent,
  };
}

function formatDryRunReport(command, plan) {
  const lines = [
    `[dry-run] Versão: ${plan.previousVersion} -> ${plan.nextVersion} (série ${plan.previousBase} -> ${plan.nextBase})`,
    `[dry-run] Arquivos que seriam atualizados:`,
    `  - ${path.relative(process.cwd(), versionTsPath) || versionTsPath}`,
    `  - ${path.relative(process.cwd(), releaseNotesPath) || releaseNotesPath}`,
  ];
  if (command.mode === 'from-pending') {
    lines.push(
      `[dry-run] Arquivo pendente que seria removido: ${path.relative(process.cwd(), command.resolvedPendingPath) || command.resolvedPendingPath}`,
    );
  }
  lines.push('[dry-run] Entradas planejadas (RELEASE_NOTES.md):');
  for (const entry of plan.prependedNewestFirst) {
    lines.push('');
    lines.push(formatBuildBlock(entry));
  }
  lines.push('');
  lines.push('[dry-run] Trecho JSON planejado em RELEASE_NOTES_HISTORY:');
  lines.push(JSON.stringify(plan.prependedNewestFirst, null, 2));
  lines.push('');
  lines.push('[dry-run] Nenhuma alteração gravada em disco.');
  return `${lines.join('\n')}\n`;
}

function main() {
  const command = parseCliArgs(process.argv.slice(2));
  if (command.mode === 'help') {
    printUsage();
    return;
  }

  const currentState = readAndValidateCurrentState();

  if (command.mode === 'check') {
    const { versionState } = currentState;
    process.stdout.write(
      `OK: version.ts e RELEASE_NOTES.md consistentes (versão atual: ${versionState.appVersion}, série: ${versionState.baseVersion.raw}, builds: ${versionState.history.length}).\n`,
    );
    return;
  }

  const plan = planUpdates(command, currentState);

  if (command.dryRun) {
    process.stdout.write(formatDryRunReport(command, plan));
    return;
  }

  writeFilesAtomically(
    currentState.versionState.content,
    plan.nextVersionTsContent,
    plan.nextReleaseNotesContent,
  );

  if (command.mode === 'from-pending') {
    try {
      fs.unlinkSync(command.resolvedPendingPath);
    } catch (err) {
      throw new CliError(
        `Versão atualizada para ${plan.nextVersion}, mas falhou ao remover "${command.resolvedPendingPath}": ${err.message}`,
      );
    }
  }

  const count = plan.plannedEntries.length;
  const suffix = count > 1 ? ` (${count} builds aplicados)` : '';
  process.stdout.write(
    `Versão atualizada: ${plan.previousVersion} -> ${plan.nextVersion}${suffix}.\n`,
  );
}

try {
  main();
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(`Erro: ${message}\n`);
  process.exitCode = 1;
}
