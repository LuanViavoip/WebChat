import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  APP_BASE_VERSION,
  APP_BUILD_NUMBER,
  APP_VERSION,
  RELEASE_NOTES_HISTORY,
  type ReleaseNote,
} from './version';

type ParsedSeries = {
  readonly raw: string;
  readonly major: number;
  readonly minor: number;
};

type ParsedVersion = {
  readonly raw: string;
  readonly major: number;
  readonly minor: number;
  readonly build: number;
  readonly series: string;
};

type ParsedMarkdownBuild = {
  readonly version: ParsedVersion;
  readonly date: string;
  readonly dateKey: number;
  readonly title: string;
  readonly details: readonly string[];
};

type ParsedMarkdownSection = {
  readonly series: ParsedSeries;
  readonly rangeStart: ParsedVersion;
  readonly rangeEnd: ParsedVersion;
  readonly builds: readonly ParsedMarkdownBuild[];
};

type ParsedReleaseNotesMarkdown = {
  readonly headerVersion: string;
  readonly headerBase: string;
  readonly headerDate: string;
  readonly sections: readonly ParsedMarkdownSection[];
  readonly builds: readonly ParsedMarkdownBuild[];
};

type ReleaseMetadataInput = {
  readonly baseVersion: string;
  readonly buildNumber: number;
  readonly appVersion: string;
  readonly history: readonly ReleaseNote[];
  readonly markdown: string;
};

const HEADER_VERSION_RE = /^>\s*\*\*Versão Atual de Compilação:\*\*\s*`([^`]+)`\s*$/;
const HEADER_BASE_RE = /^>\s*\*\*Série Base Atual:\*\*\s*`([^`]+)`\s*$/;
const HEADER_DATE_RE = /^>\s*\*\*Última Atualização:\*\*\s*`([^`]+)`\s*$/;
const SECTION_HEADER_RE =
  /^## 📦 Histórico de Alterações — Série `([^`]+)` \(`([^`]+)` a `([^`]+)`\)$/;
const BUILD_HEADER_RE = /^### Build `([^`]+)` — \*([^*]+)\*$/;
const DATE_RE = /^(\d{2})\/(\d{2})\/(\d{4})$/;

function parseSegmentNoLeadingZero(raw: string, label: string): number {
  if (!/^\d+$/.test(raw)) {
    throw new Error(`${label} inválido ("${raw}"): esperado número inteiro não negativo.`);
  }
  if (raw.length > 1 && raw.startsWith('0')) {
    throw new Error(`${label} inválido ("${raw}"): zero à esquerda não é permitido.`);
  }
  return Number(raw);
}

function parseStrictSeries(raw: string, label: string): ParsedSeries {
  const parts = raw.split('.');
  if (parts.length !== 2) {
    throw new Error(`${label} inválido ("${raw}"): esperado formato <MAJOR>.<MINOR>.`);
  }
  const majorRaw = parts[0];
  const minorRaw = parts[1];
  if (majorRaw === undefined || minorRaw === undefined) {
    throw new Error(`${label} inválido ("${raw}"): esperado formato <MAJOR>.<MINOR>.`);
  }
  const major = parseSegmentNoLeadingZero(majorRaw, `${label} (MAJOR)`);
  const minor = parseSegmentNoLeadingZero(minorRaw, `${label} (MINOR)`);
  return { raw, major, minor };
}

function parseStrictVersion(raw: string, label: string): ParsedVersion {
  const parts = raw.split('.');
  if (parts.length !== 3) {
    throw new Error(`${label} inválido ("${raw}"): esperado formato <MAJOR>.<MINOR>.<BUILD>.`);
  }
  const majorRaw = parts[0];
  const minorRaw = parts[1];
  const buildRaw = parts[2];
  if (majorRaw === undefined || minorRaw === undefined || buildRaw === undefined) {
    throw new Error(`${label} inválido ("${raw}"): esperado formato <MAJOR>.<MINOR>.<BUILD>.`);
  }
  const major = parseSegmentNoLeadingZero(majorRaw, `${label} (MAJOR)`);
  const minor = parseSegmentNoLeadingZero(minorRaw, `${label} (MINOR)`);
  const build = parseSegmentNoLeadingZero(buildRaw, `${label} (BUILD)`);
  if (build === 0) {
    throw new Error(`${label} inválido ("${raw}"): build .0 não é permitido.`);
  }
  return {
    raw,
    major,
    minor,
    build,
    series: `${majorRaw}.${minorRaw}`,
  };
}

function compareSeries(a: ParsedSeries, b: ParsedSeries): number {
  if (a.major !== b.major) {
    return a.major - b.major;
  }
  return a.minor - b.minor;
}

function parseStrictDate(raw: string, label: string): number {
  const match = DATE_RE.exec(raw);
  if (!match) {
    throw new Error(`${label} inválido ("${raw}"): esperado formato DD/MM/AAAA.`);
  }
  const dayRaw = match[1];
  const monthRaw = match[2];
  const yearRaw = match[3];
  if (dayRaw === undefined || monthRaw === undefined || yearRaw === undefined) {
    throw new Error(`${label} inválido ("${raw}"): esperado formato DD/MM/AAAA.`);
  }
  const day = Number(dayRaw);
  const month = Number(monthRaw);
  const year = Number(yearRaw);
  if (year < 1000 || month < 1 || month > 12 || day < 1 || day > 31) {
    throw new Error(`${label} inválido ("${raw}"): data fora dos limites do calendário.`);
  }
  const utc = new Date(Date.UTC(year, month - 1, day));
  if (
    utc.getUTCFullYear() !== year ||
    utc.getUTCMonth() !== month - 1 ||
    utc.getUTCDate() !== day
  ) {
    throw new Error(`${label} inválido ("${raw}"): data inexistente no calendário.`);
  }
  return year * 10000 + month * 100 + day;
}

function validateTrimmedLine(value: string, label: string): void {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new Error(`${label} não pode ser vazio.`);
  }
  if (trimmed !== value) {
    throw new Error(`${label} não pode ter espaços extras nas extremidades.`);
  }
  if (/[\r\n]/.test(value)) {
    throw new Error(`${label} deve ocupar uma única linha.`);
  }
}

function validateHistoryEntries(history: readonly ReleaseNote[]): void {
  if (history.length === 0) {
    throw new Error('RELEASE_NOTES_HISTORY não pode estar vazio.');
  }

  let prevSeries: ParsedSeries | null = null;
  let prevBuild: number | null = null;
  let newerDateKey: number | null = null;
  let newerVersionLabel = '';
  let newerDateLabel = '';
  const seenSeries = new Set<string>();

  for (let i = 0; i < history.length; i += 1) {
    const entry = history[i];
    if (entry === undefined) {
      continue;
    }
    const prefix = `RELEASE_NOTES_HISTORY[${String(i)}]`;
    const parsedVersion = parseStrictVersion(entry.version, `${prefix}.version`);
    const dateKey = parseStrictDate(entry.date, `${prefix}.date`);
    validateTrimmedLine(entry.title, `${prefix}.title`);

    if (entry.details.length === 0) {
      throw new Error(`${prefix}.details não pode estar vazio.`);
    }
    for (let j = 0; j < entry.details.length; j += 1) {
      const detail = entry.details[j];
      if (detail !== undefined) {
        validateTrimmedLine(detail, `${prefix}.details[${String(j)}]`);
      }
    }

    if (newerDateKey !== null && dateKey > newerDateKey) {
      throw new Error(
        `Ordem cronológica regressiva em RELEASE_NOTES_HISTORY: "${entry.version}" (${entry.date}) é posterior a "${newerVersionLabel}" (${newerDateLabel}).`,
      );
    }
    newerDateKey = dateKey;
    newerVersionLabel = entry.version;
    newerDateLabel = entry.date;

    if (prevSeries === null) {
      seenSeries.add(parsedVersion.series);
      prevSeries = parseStrictSeries(parsedVersion.series, `${prefix}.version (série)`);
      prevBuild = parsedVersion.build;
    } else if (parsedVersion.series === prevSeries.raw) {
      if (prevBuild === null || parsedVersion.build !== prevBuild - 1) {
        const expected = prevBuild === null ? 1 : prevBuild - 1;
        throw new Error(
          `Lacuna ou ordem inválida na série "${parsedVersion.series}" em RELEASE_NOTES_HISTORY: esperado "${parsedVersion.series}.${String(expected)}", encontrado "${entry.version}".`,
        );
      }
      prevBuild = parsedVersion.build;
    } else {
      if (prevBuild !== 1) {
        throw new Error(
          `Série "${prevSeries.raw}" em RELEASE_NOTES_HISTORY não termina no build .1 (parou em "${prevSeries.raw}.${String(prevBuild ?? 0)}").`,
        );
      }
      const currSeries = parseStrictSeries(parsedVersion.series, `${prefix}.version (série)`);
      if (seenSeries.has(parsedVersion.series) || compareSeries(currSeries, prevSeries) >= 0) {
        throw new Error(
          `Séries fora de ordem numérica decrescente estrita em RELEASE_NOTES_HISTORY: "${parsedVersion.series}" deve ser menor que "${prevSeries.raw}".`,
        );
      }
      seenSeries.add(parsedVersion.series);
      prevSeries = currSeries;
      prevBuild = parsedVersion.build;
    }
  }

  if (prevSeries !== null && prevBuild !== 1) {
    throw new Error(
      `Série "${prevSeries.raw}" em RELEASE_NOTES_HISTORY não termina no build .1 (parou em "${prevSeries.raw}.${String(prevBuild ?? 0)}").`,
    );
  }
}

function extractSingleHeaderField(
  lines: readonly string[],
  regex: RegExp,
  label: string,
): string {
  const matches: string[] = [];
  for (const line of lines) {
    const match = regex.exec(line);
    const captured = match?.[1];
    if (captured !== undefined) {
      matches.push(captured);
    }
  }
  if (matches.length !== 1) {
    throw new Error(`Cabeçalho "${label}" deve aparecer exatamente uma vez em RELEASE_NOTES.md.`);
  }
  const value = matches[0];
  if (value === undefined) {
    throw new Error(`Cabeçalho "${label}" ausente em RELEASE_NOTES.md.`);
  }
  return value;
}

type MutableBuild = {
  readonly version: ParsedVersion;
  readonly date: string;
  readonly dateKey: number;
  title: string | null;
  readonly details: string[];
};

type MutableSection = {
  readonly series: ParsedSeries;
  readonly rangeStart: ParsedVersion;
  readonly rangeEnd: ParsedVersion;
  readonly builds: MutableBuild[];
};

function flushBuildBlock(
  section: MutableSection | null,
  build: MutableBuild | null,
  lineNumber: number,
): void {
  if (build === null) {
    return;
  }
  if (section === null) {
    throw new Error(`Bloco ### Build "${build.version.raw}" fora de seção (linha ${String(lineNumber)}).`);
  }
  if (build.title === null) {
    throw new Error(
      `Bloco ### Build "${build.version.raw}" sem título em negrito antes da linha ${String(lineNumber)}.`,
    );
  }
  if (build.details.length === 0) {
    throw new Error(
      `Bloco ### Build "${build.version.raw}" sem itens de detalhe antes da linha ${String(lineNumber)}.`,
    );
  }
  section.builds.push(build);
}

function parseReleaseNotesMarkdown(markdown: string): ParsedReleaseNotesMarkdown {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  const firstSectionIdx = lines.findIndex((line) => line.startsWith('## 📦 Histórico de Alterações'));
  if (firstSectionIdx === -1) {
    throw new Error('Nenhuma seção "## 📦 Histórico de Alterações" encontrada em RELEASE_NOTES.md.');
  }

  const preambleLines = lines.slice(0, firstSectionIdx);
  for (let i = 0; i < preambleLines.length; i += 1) {
    const line = preambleLines[i];
    if (line === undefined) {
      continue;
    }
    if (line.startsWith('### Build')) {
      throw new Error(
        `Bloco "### Build" encontrado antes da primeira seção de histórico (linha ${String(i + 1)}).`,
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

  parseStrictVersion(headerVersion, 'Cabeçalho Versão Atual de Compilação');
  parseStrictSeries(headerBase, 'Cabeçalho Série Base Atual');
  parseStrictDate(headerDate, 'Cabeçalho Última Atualização');

  const sections: MutableSection[] = [];
  const seenSeries = new Set<string>();
  let currentSection: MutableSection | null = null;
  let currentBuild: MutableBuild | null = null;
  let sawSeparator = false;

  for (let idx = firstSectionIdx; idx < lines.length; idx += 1) {
    const line = lines[idx];
    if (line === undefined) {
      continue;
    }
    const lineNo = idx + 1;

    if (line.trim() === '') {
      if (currentBuild !== null) {
        flushBuildBlock(currentSection, currentBuild, lineNo);
        currentBuild = null;
      }
      continue;
    }

    if (line.trim() === '---') {
      if (currentBuild !== null) {
        flushBuildBlock(currentSection, currentBuild, lineNo);
        currentBuild = null;
      }
      if (currentSection === null) {
        throw new Error(`Separador "---" inesperado na linha ${String(lineNo)}.`);
      }
      if (sawSeparator) {
        throw new Error(`Separador "---" duplicado na linha ${String(lineNo)}.`);
      }
      sawSeparator = true;
      continue;
    }

    if (line.startsWith('## ')) {
      if (currentBuild !== null) {
        flushBuildBlock(currentSection, currentBuild, lineNo);
        currentBuild = null;
      }
      const match = SECTION_HEADER_RE.exec(line);
      const seriesRaw = match?.[1];
      const startRaw = match?.[2];
      const endRaw = match?.[3];
      if (seriesRaw === undefined || startRaw === undefined || endRaw === undefined) {
        throw new Error(`Cabeçalho de seção inválido na linha ${String(lineNo)}: "${line}".`);
      }
      const series = parseStrictSeries(seriesRaw, `Seção linha ${String(lineNo)} (Série)`);
      const rangeStart = parseStrictVersion(startRaw, `Seção linha ${String(lineNo)} (início da faixa)`);
      const rangeEnd = parseStrictVersion(endRaw, `Seção linha ${String(lineNo)} (fim da faixa)`);

      if (rangeStart.series !== series.raw || rangeStart.build !== 1) {
        throw new Error(
          `Faixa da seção "${series.raw}" inválida na linha ${String(lineNo)}: início esperado "${series.raw}.1", encontrado "${rangeStart.raw}".`,
        );
      }
      if (rangeEnd.series !== series.raw) {
        throw new Error(
          `Faixa da seção "${series.raw}" inválida na linha ${String(lineNo)}: fim "${rangeEnd.raw}" não pertence à série.`,
        );
      }
      if (seenSeries.has(series.raw) || (currentSection !== null && compareSeries(series, currentSection.series) >= 0)) {
        const previousSeriesRaw = currentSection?.series.raw ?? series.raw;
        throw new Error(
          `Séries fora de ordem numérica decrescente estrita em RELEASE_NOTES.md (linha ${String(lineNo)}): "${series.raw}" deve ser menor que "${previousSeriesRaw}".`,
        );
      }

      seenSeries.add(series.raw);
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
        throw new Error(`Separador "---" sem cabeçalho de seção antes do build (linha ${String(lineNo)}).`);
      }
      if (currentSection === null) {
        throw new Error(`Bloco "### Build" sem seção na linha ${String(lineNo)}.`);
      }
      if (currentBuild !== null) {
        flushBuildBlock(currentSection, currentBuild, lineNo);
        currentBuild = null;
      }
      const match = BUILD_HEADER_RE.exec(line);
      const versionRaw = match?.[1];
      const dateRaw = match?.[2];
      if (versionRaw === undefined || dateRaw === undefined) {
        throw new Error(`Cabeçalho de build inválido na linha ${String(lineNo)}: "${line}".`);
      }
      const version = parseStrictVersion(versionRaw, `Build linha ${String(lineNo)}`);
      const dateKey = parseStrictDate(dateRaw, `Data do build "${version.raw}" (linha ${String(lineNo)})`);
      if (version.series !== currentSection.series.raw) {
        throw new Error(
          `Build "${version.raw}" (linha ${String(lineNo)}) não pertence à seção da série "${currentSection.series.raw}".`,
        );
      }
      currentBuild = {
        version,
        date: dateRaw,
        dateKey,
        title: null,
        details: [],
      };
      continue;
    }

    if (currentBuild !== null && currentBuild.title === null) {
      const titleMatch = /^\*\*(.+)\*\*$/.exec(line);
      const titleText = titleMatch?.[1];
      if (titleText === undefined) {
        throw new Error(`Título em negrito esperado na linha ${String(lineNo)}: "${line}".`);
      }
      validateTrimmedLine(titleText, `Título do build "${currentBuild.version.raw}"`);
      currentBuild.title = titleText;
      continue;
    }

    if (currentBuild !== null && currentBuild.title !== null) {
      const detailMatch = /^- (.+)$/.exec(line);
      const detailText = detailMatch?.[1];
      if (detailText === undefined) {
        throw new Error(`Item de detalhe "- ..." esperado na linha ${String(lineNo)}: "${line}".`);
      }
      validateTrimmedLine(detailText, `Detalhe do build "${currentBuild.version.raw}"`);
      currentBuild.details.push(detailText);
      continue;
    }

    throw new Error(`Conteúdo inesperado na linha ${String(lineNo)} de RELEASE_NOTES.md: "${line}".`);
  }

  if (sawSeparator) {
    throw new Error('Separador "---" sem seção seguinte no final de RELEASE_NOTES.md.');
  }
  if (currentBuild !== null) {
    flushBuildBlock(currentSection, currentBuild, lines.length + 1);
  }

  const normalizedSections: ParsedMarkdownSection[] = [];
  const allBuilds: ParsedMarkdownBuild[] = [];
  let newerDateKey: number | null = null;
  let newerBuildVersion = '';
  let newerBuildDate = '';

  for (const section of sections) {
    if (section.builds.length === 0) {
      throw new Error(`Seção da série "${section.series.raw}" não possui builds.`);
    }
    const firstInSection = section.builds[0];
    if (firstInSection === undefined || firstInSection.version.build !== section.rangeEnd.build) {
      const found = firstInSection?.version.raw ?? 'nenhum';
      throw new Error(
        `Faixa da série "${section.series.raw}" inconsistente: cabeçalho declara até "${section.rangeEnd.raw}", primeiro build é "${found}".`,
      );
    }

    let expectedBuild = section.rangeEnd.build;
    const finalizedBuilds: ParsedMarkdownBuild[] = [];
    for (const build of section.builds) {
      if (build.version.build !== expectedBuild) {
        throw new Error(
          `Lacuna ou ordem inválida na série "${section.series.raw}" em RELEASE_NOTES.md: esperado "${section.series.raw}.${String(expectedBuild)}", encontrado "${build.version.raw}".`,
        );
      }
      if (newerDateKey !== null && build.dateKey > newerDateKey) {
        throw new Error(
          `Ordem cronológica regressiva em RELEASE_NOTES.md: "${build.version.raw}" (${build.date}) é posterior a "${newerBuildVersion}" (${newerBuildDate}).`,
        );
      }
      newerDateKey = build.dateKey;
      newerBuildVersion = build.version.raw;
      newerBuildDate = build.date;

      const finalized: ParsedMarkdownBuild = {
        version: build.version,
        date: build.date,
        dateKey: build.dateKey,
        title: build.title ?? '',
        details: build.details,
      };
      finalizedBuilds.push(finalized);
      allBuilds.push(finalized);
      expectedBuild -= 1;
    }

    if (expectedBuild !== 0) {
      throw new Error(
        `Série "${section.series.raw}" em RELEASE_NOTES.md não termina no build .1 (parou em "${section.series.raw}.${String(expectedBuild + 1)}").`,
      );
    }

    normalizedSections.push({
      series: section.series,
      rangeStart: section.rangeStart,
      rangeEnd: section.rangeEnd,
      builds: finalizedBuilds,
    });
  }

  return {
    headerVersion,
    headerBase,
    headerDate,
    sections: normalizedSections,
    builds: allBuilds,
  };
}

function validateReleaseMetadata(input: ReleaseMetadataInput): void {
  const baseSeries = parseStrictSeries(input.baseVersion, 'APP_BASE_VERSION');
  if (!Number.isInteger(input.buildNumber)) {
    throw new Error(`APP_BUILD_NUMBER inválido (${String(input.buildNumber)}): deve ser inteiro.`);
  }
  if (input.buildNumber === 0) {
    throw new Error('APP_BUILD_NUMBER não pode ser 0: build .0 não é permitido.');
  }
  if (input.buildNumber < 1) {
    throw new Error(`APP_BUILD_NUMBER inválido (${String(input.buildNumber)}): esperado >= 1.`);
  }

  const parsedAppVersion = parseStrictVersion(input.appVersion, 'APP_VERSION');
  const expectedAppVersion = `${baseSeries.raw}.${String(input.buildNumber)}`;
  if (parsedAppVersion.raw !== expectedAppVersion) {
    throw new Error(
      `APP_VERSION ("${input.appVersion}") diverge de APP_BASE_VERSION + APP_BUILD_NUMBER ("${expectedAppVersion}").`,
    );
  }

  validateHistoryEntries(input.history);
  const newestHistory = input.history[0];
  if (newestHistory === undefined) {
    throw new Error('RELEASE_NOTES_HISTORY não pode estar vazio.');
  }
  if (newestHistory.version !== parsedAppVersion.raw) {
    throw new Error(
      `RELEASE_NOTES_HISTORY[0].version ("${newestHistory.version}") difere de APP_VERSION ("${parsedAppVersion.raw}").`,
    );
  }

  const markdownState = parseReleaseNotesMarkdown(input.markdown);
  if (markdownState.headerVersion !== parsedAppVersion.raw) {
    throw new Error(
      `Cabeçalho "Versão Atual de Compilação" ("${markdownState.headerVersion}") difere de APP_VERSION ("${parsedAppVersion.raw}").`,
    );
  }
  if (markdownState.headerBase !== baseSeries.raw) {
    throw new Error(
      `Cabeçalho "Série Base Atual" ("${markdownState.headerBase}") difere de APP_BASE_VERSION ("${baseSeries.raw}").`,
    );
  }
  if (markdownState.headerDate !== newestHistory.date) {
    throw new Error(
      `Cabeçalho "Última Atualização" ("${markdownState.headerDate}") difere de RELEASE_NOTES_HISTORY[0].date ("${newestHistory.date}").`,
    );
  }

  const firstMdBuild = markdownState.builds[0];
  if (firstMdBuild === undefined || firstMdBuild.version.raw !== parsedAppVersion.raw) {
    throw new Error(
      `Primeiro "### Build" de RELEASE_NOTES.md ("${firstMdBuild?.version.raw ?? 'nenhum'}") difere de APP_VERSION ("${parsedAppVersion.raw}").`,
    );
  }

  if (markdownState.builds.length !== input.history.length) {
    throw new Error(
      `Quantidade de builds diverge entre RELEASE_NOTES.md (${String(markdownState.builds.length)}) e RELEASE_NOTES_HISTORY (${String(input.history.length)}).`,
    );
  }

  for (let i = 0; i < input.history.length; i += 1) {
    const mdBuild = markdownState.builds[i];
    const histEntry = input.history[i];
    if (mdBuild === undefined || histEntry === undefined) {
      continue;
    }
    if (mdBuild.version.raw !== histEntry.version) {
      throw new Error(
        `Divergência de versão no índice ${String(i)}: RELEASE_NOTES.md tem "${mdBuild.version.raw}", RELEASE_NOTES_HISTORY tem "${histEntry.version}".`,
      );
    }
    if (mdBuild.date !== histEntry.date) {
      throw new Error(
        `Divergência de data no build "${histEntry.version}": RELEASE_NOTES.md tem "${mdBuild.date}", RELEASE_NOTES_HISTORY tem "${histEntry.date}".`,
      );
    }
    if (mdBuild.title !== histEntry.title) {
      throw new Error(
        `Divergência de título no build "${histEntry.version}": RELEASE_NOTES.md difere de RELEASE_NOTES_HISTORY.`,
      );
    }
    if (mdBuild.details.length !== histEntry.details.length) {
      throw new Error(
        `Divergência na quantidade de detalhes do build "${histEntry.version}" entre RELEASE_NOTES.md (${String(mdBuild.details.length)}) e RELEASE_NOTES_HISTORY (${String(histEntry.details.length)}).`,
      );
    }
    for (let j = 0; j < histEntry.details.length; j += 1) {
      const mdDetail = mdBuild.details[j];
      const histDetail = histEntry.details[j];
      if (mdDetail !== histDetail) {
        throw new Error(
          `Divergência no detalhe [${String(j)}] do build "${histEntry.version}" entre RELEASE_NOTES.md e RELEASE_NOTES_HISTORY.`,
        );
      }
    }
  }
}

type FixtureSectionSpec = {
  readonly series: string;
  readonly rangeStart?: string;
  readonly rangeEnd?: string;
  readonly entries: readonly ReleaseNote[];
};

type FixtureOptions = {
  readonly baseVersion?: string;
  readonly buildNumber?: number;
  readonly appVersion?: string;
  readonly headerVersion?: string;
  readonly headerBase?: string;
  readonly headerDate?: string;
  readonly history?: readonly ReleaseNote[];
  readonly sections: readonly FixtureSectionSpec[];
};

function renderFixtureMarkdown(options: FixtureOptions): string {
  const allEntries = options.sections.flatMap((section) => section.entries);
  const newest = allEntries[0];
  const headerVersion = options.headerVersion ?? options.appVersion ?? newest?.version ?? '1.0.1';
  const headerBase = options.headerBase ?? options.baseVersion ?? '1.0';
  const headerDate = options.headerDate ?? newest?.date ?? '18/11/2026';

  const renderedSections = options.sections
    .map((section) => {
      const firstEntry = section.entries[0];
      const lastEntry = section.entries[section.entries.length - 1];
      const rangeStart = section.rangeStart ?? lastEntry?.version ?? `${section.series}.1`;
      const rangeEnd = section.rangeEnd ?? firstEntry?.version ?? `${section.series}.1`;
      const header = `## 📦 Histórico de Alterações — Série \`${section.series}\` (\`${rangeStart}\` a \`${rangeEnd}\`)`;
      const blocks = section.entries
        .map((entry) =>
          [
            `### Build \`${entry.version}\` — *${entry.date}*`,
            `**${entry.title}**`,
            ...entry.details.map((detail) => `- ${detail}`),
          ].join('\n'),
        )
        .join('\n\n');
      return `${header}\n\n${blocks}`;
    })
    .join('\n\n---\n\n');

  return [
    '# Chat Interno ViaVoip — Release Notes & Controle de Versão de Compilação',
    '',
    `> **Versão Atual de Compilação:** \`${headerVersion}\`  `,
    `> **Série Base Atual:** \`${headerBase}\`  `,
    `> **Última Atualização:** \`${headerDate}\``,
    '',
    '---',
    '',
    '## 🤖 Protocolo de versionamento (resumo)',
    '',
    'Formato `<MAJOR>.<MINOR>.<BUILD>` sem zeros à esquerda.',
    '',
    '---',
    '',
    renderedSections,
    '',
  ].join('\n');
}

function makeFixture(options: FixtureOptions): ReleaseMetadataInput {
  const allEntries = options.sections.flatMap((section) => section.entries);
  const newest = allEntries[0];
  const baseVersion = options.baseVersion ?? '1.0';
  const buildNumber = options.buildNumber ?? 1;
  const appVersion = options.appVersion ?? newest?.version ?? `${baseVersion}.${String(buildNumber)}`;
  return {
    baseVersion,
    buildNumber,
    appVersion,
    history: options.history ?? allEntries,
    markdown: renderFixtureMarkdown(options),
  };
}

describe('versionamento e RELEASE_NOTES.md (spec D.6)', () => {
  it('valida o estado real atual do repositório (src/version.ts + RELEASE_NOTES.md)', () => {
    const testModuleUrl = import.meta.url;
    const markdown = fs.readFileSync(
      fileURLToPath(new URL('../RELEASE_NOTES.md', testModuleUrl)),
      'utf8',
    );

    expect(() => {
      validateReleaseMetadata({
        baseVersion: APP_BASE_VERSION,
        buildNumber: APP_BUILD_NUMBER,
        appVersion: APP_VERSION,
        history: RELEASE_NOTES_HISTORY,
        markdown,
      });
    }).not.toThrow();
  });

  it('aceita histórico positivo com múltiplas séries e múltiplos builds (1.1.1 + 1.0.2 + 1.0.1)', () => {
    const fixture = makeFixture({
      baseVersion: '1.1',
      buildNumber: 1,
      appVersion: '1.1.1',
      sections: [
        {
          series: '1.1',
          entries: [
            {
              version: '1.1.1',
              date: '20/11/2026',
              title: 'Início da série 1.1',
              details: ['Novo fluxo de conversas internas.'],
            },
          ],
        },
        {
          series: '1.0',
          entries: [
            {
              version: '1.0.2',
              date: '19/11/2026',
              title: 'Ajuste de rolagem no chat',
              details: ['Mantém posição ao carregar histórico antigo.'],
            },
            {
              version: '1.0.1',
              date: '18/11/2026',
              title: 'Base inicial do versionamento',
              details: ['Criação de `src/version.ts` e `RELEASE_NOTES.md`.'],
            },
          ],
        },
      ],
    });

    expect(() => {
      validateReleaseMetadata(fixture);
    }).not.toThrow();
  });

  it('ordena séries numericamente e não lexicograficamente (1.10 > 1.9 > 1.0)', () => {
    const fixture = makeFixture({
      baseVersion: '1.10',
      buildNumber: 1,
      appVersion: '1.10.1',
      sections: [
        {
          series: '1.10',
          entries: [
            {
              version: '1.10.1',
              date: '21/11/2026',
              title: 'Série 1.10',
              details: ['Série dez vem antes da nove.'],
            },
          ],
        },
        {
          series: '1.9',
          entries: [
            {
              version: '1.9.1',
              date: '20/11/2026',
              title: 'Série 1.9',
              details: ['Série nove.'],
            },
          ],
        },
        {
          series: '1.0',
          entries: [
            {
              version: '1.0.1',
              date: '18/11/2026',
              title: 'Série 1.0',
              details: ['Série inicial.'],
            },
          ],
        },
      ],
    });

    expect(() => {
      validateReleaseMetadata(fixture);
    }).not.toThrow();
  });

  describe('fixtures negativas', () => {
    it('1. rejeita lacuna de build (1.0.3 direto para 1.0.1) e série não terminando em .1', () => {
      const gapFixture = makeFixture({
        baseVersion: '1.0',
        buildNumber: 3,
        appVersion: '1.0.3',
        sections: [
          {
            series: '1.0',
            entries: [
              {
                version: '1.0.3',
                date: '20/11/2026',
                title: 'Build três',
                details: ['Pulou o build 2.'],
              },
              {
                version: '1.0.1',
                date: '18/11/2026',
                title: 'Build um',
                details: ['Inicial.'],
              },
            ],
          },
        ],
      });

      expect(() => {
        validateReleaseMetadata(gapFixture);
      }).toThrow(/Lacuna ou ordem inválida na série "1\.0"/);

      const missingBuildOneFixture = makeFixture({
        baseVersion: '1.0',
        buildNumber: 2,
        appVersion: '1.0.2',
        sections: [
          {
            series: '1.0',
            rangeStart: '1.0.1',
            rangeEnd: '1.0.2',
            entries: [
              {
                version: '1.0.2',
                date: '19/11/2026',
                title: 'Sem build 1',
                details: ['Falta o build .1.'],
              },
            ],
          },
        ],
      });

      expect(() => {
        validateReleaseMetadata(missingBuildOneFixture);
      }).toThrow(/não termina no build \.1/);
    });

    it('2. rejeita zero à esquerda (1.0.01, 01.0.1, 1.01.1)', () => {
      for (const badVersion of ['1.0.01', '01.0.1', '1.01.1']) {
        const parts = badVersion.split('.');
        const badBase = `${parts[0] ?? '1'}.${parts[1] ?? '0'}`;
        const fixture = makeFixture({
          baseVersion: badBase,
          buildNumber: 1,
          appVersion: badVersion,
          sections: [
            {
              series: badBase,
              entries: [
                {
                  version: badVersion,
                  date: '18/11/2026',
                  title: 'Zero à esquerda',
                  details: ['Formato inválido.'],
                },
              ],
            },
          ],
        });

        expect(() => {
          validateReleaseMetadata(fixture);
        }).toThrow(/zero à esquerda/i);
      }
    });

    it('3. rejeita build .0 (1.0.0)', () => {
      const fixture = makeFixture({
        baseVersion: '1.0',
        buildNumber: 0,
        appVersion: '1.0.0',
        sections: [
          {
            series: '1.0',
            entries: [
              {
                version: '1.0.0',
                date: '18/11/2026',
                title: 'Build zero',
                details: ['Não pode existir x.y.0.'],
              },
            ],
          },
        ],
      });

      expect(() => {
        validateReleaseMetadata(fixture);
      }).toThrow(/build \.0 não é permitido/);

      const historyZeroFixture = makeFixture({
        baseVersion: '1.0',
        buildNumber: 1,
        appVersion: '1.0.1',
        sections: [
          {
            series: '1.0',
            entries: [
              {
                version: '1.0.1',
                date: '19/11/2026',
                title: 'Build um',
                details: ['Inicial.'],
              },
              {
                version: '1.0.0',
                date: '18/11/2026',
                title: 'Build zero antigo',
                details: ['Não pode existir x.y.0.'],
              },
            ],
          },
        ],
      });

      expect(() => {
        validateReleaseMetadata(historyZeroFixture);
      }).toThrow(/build \.0 não é permitido/);
    });

    it('4. rejeita cabeçalho divergente e primeiro ### Build divergente de APP_VERSION', () => {
      const baseEntry: ReleaseNote = {
        version: '1.0.1',
        date: '18/11/2026',
        title: 'Build inicial',
        details: ['Detalhe inicial.'],
      };

      const wrongHeaderVersion = makeFixture({
        baseVersion: '1.0',
        buildNumber: 1,
        appVersion: '1.0.1',
        headerVersion: '1.0.2',
        sections: [{ series: '1.0', entries: [baseEntry] }],
      });
      expect(() => {
        validateReleaseMetadata(wrongHeaderVersion);
      }).toThrow(/Versão Atual de Compilação.*difere de APP_VERSION/);

      const wrongHeaderBase = makeFixture({
        baseVersion: '1.0',
        buildNumber: 1,
        appVersion: '1.0.1',
        headerBase: '1.1',
        sections: [{ series: '1.0', entries: [baseEntry] }],
      });
      expect(() => {
        validateReleaseMetadata(wrongHeaderBase);
      }).toThrow(/Série Base Atual.*difere de APP_BASE_VERSION/);

      const wrongHeaderDate = makeFixture({
        baseVersion: '1.0',
        buildNumber: 1,
        appVersion: '1.0.1',
        headerDate: '19/11/2026',
        sections: [{ series: '1.0', entries: [baseEntry] }],
      });
      expect(() => {
        validateReleaseMetadata(wrongHeaderDate);
      }).toThrow(/Última Atualização.*difere de RELEASE_NOTES_HISTORY\[0\]\.date/);

      const wrongFirstBuild = makeFixture({
        baseVersion: '1.0',
        buildNumber: 2,
        appVersion: '1.0.2',
        headerVersion: '1.0.2',
        headerDate: '19/11/2026',
        history: [
          {
            version: '1.0.2',
            date: '19/11/2026',
            title: 'Build dois',
            details: ['No histórico tem 1.0.2.'],
          },
          baseEntry,
        ],
        sections: [{ series: '1.0', entries: [baseEntry] }],
      });
      expect(() => {
        validateReleaseMetadata(wrongFirstBuild);
      }).toThrow(/Primeiro "### Build".*difere de APP_VERSION/);
    });

    it('5. rejeita faixa da série errada no título da seção', () => {
      const wrongEndRange = makeFixture({
        baseVersion: '1.0',
        buildNumber: 2,
        appVersion: '1.0.2',
        sections: [
          {
            series: '1.0',
            rangeStart: '1.0.1',
            rangeEnd: '1.0.1',
            entries: [
              {
                version: '1.0.2',
                date: '19/11/2026',
                title: 'Build dois',
                details: ['Detalhe dois.'],
              },
              {
                version: '1.0.1',
                date: '18/11/2026',
                title: 'Build um',
                details: ['Detalhe um.'],
              },
            ],
          },
        ],
      });
      expect(() => {
        validateReleaseMetadata(wrongEndRange);
      }).toThrow(/Faixa da série "1\.0" inconsistente/);

      const wrongStartRange = makeFixture({
        baseVersion: '1.0',
        buildNumber: 2,
        appVersion: '1.0.2',
        sections: [
          {
            series: '1.0',
            rangeStart: '1.0.2',
            rangeEnd: '1.0.2',
            entries: [
              {
                version: '1.0.2',
                date: '19/11/2026',
                title: 'Build dois',
                details: ['Detalhe dois.'],
              },
              {
                version: '1.0.1',
                date: '18/11/2026',
                title: 'Build um',
                details: ['Detalhe um.'],
              },
            ],
          },
        ],
      });
      expect(() => {
        validateReleaseMetadata(wrongStartRange);
      }).toThrow(/Faixa da seção "1\.0" inválida.*início esperado "1\.0\.1"/);
    });

    it('6. rejeita bloco do Markdown divergente de RELEASE_NOTES_HISTORY (versão, data, título, detalhe e contagem)', () => {
      const entry2: ReleaseNote = {
        version: '1.0.2',
        date: '19/11/2026',
        title: 'Título oficial',
        details: ['Detalhe A', 'Detalhe B'],
      };
      const entry1: ReleaseNote = {
        version: '1.0.1',
        date: '18/11/2026',
        title: 'Base inicial',
        details: ['Primeiro detalhe'],
      };

      const wrongVersionFixture = makeFixture({
        baseVersion: '1.2',
        buildNumber: 1,
        appVersion: '1.2.1',
        history: [
          {
            version: '1.2.1',
            date: '20/11/2026',
            title: 'Série 1.2',
            details: ['Atualização principal.'],
          },
          {
            version: '1.1.1',
            date: '19/11/2026',
            title: 'Série anterior no history',
            details: ['Item da 1.1.1.'],
          },
        ],
        sections: [
          {
            series: '1.2',
            entries: [
              {
                version: '1.2.1',
                date: '20/11/2026',
                title: 'Série 1.2',
                details: ['Atualização principal.'],
              },
            ],
          },
          {
            series: '1.0',
            entries: [
              {
                version: '1.0.1',
                date: '19/11/2026',
                title: 'Série anterior no Markdown',
                details: ['Item da 1.0.1.'],
              },
            ],
          },
        ],
      });
      expect(() => {
        validateReleaseMetadata(wrongVersionFixture);
      }).toThrow(/Divergência de versão no índice 1/);

      const wrongDateFixture = makeFixture({
        baseVersion: '1.0',
        buildNumber: 2,
        appVersion: '1.0.2',
        history: [entry2, entry1],
        sections: [
          {
            series: '1.0',
            entries: [entry2, { ...entry1, date: '17/11/2026' }],
          },
        ],
      });
      expect(() => {
        validateReleaseMetadata(wrongDateFixture);
      }).toThrow(/Divergência de data no build "1\.0\.1"/);

      const wrongTitleFixture = makeFixture({
        baseVersion: '1.0',
        buildNumber: 2,
        appVersion: '1.0.2',
        history: [entry2, entry1],
        sections: [
          {
            series: '1.0',
            entries: [{ ...entry2, title: 'Título adulterado no Markdown' }, entry1],
          },
        ],
      });
      expect(() => {
        validateReleaseMetadata(wrongTitleFixture);
      }).toThrow(/Divergência de título no build "1\.0\.2"/);

      const wrongDetailFixture = makeFixture({
        baseVersion: '1.0',
        buildNumber: 2,
        appVersion: '1.0.2',
        history: [entry2, entry1],
        sections: [
          {
            series: '1.0',
            entries: [{ ...entry2, details: ['Detalhe A', 'Detalhe adulterado'] }, entry1],
          },
        ],
      });
      expect(() => {
        validateReleaseMetadata(wrongDetailFixture);
      }).toThrow(/Divergência no detalhe \[1\] do build "1\.0\.2"/);

      const detailCountMismatchFixture = makeFixture({
        baseVersion: '1.0',
        buildNumber: 2,
        appVersion: '1.0.2',
        history: [entry2, entry1],
        sections: [
          {
            series: '1.0',
            entries: [{ ...entry2, details: ['Detalhe A'] }, entry1],
          },
        ],
      });
      expect(() => {
        validateReleaseMetadata(detailCountMismatchFixture);
      }).toThrow(/Divergência na quantidade de detalhes do build "1\.0\.2"/);

      const extraBuildInHistoryFixture = makeFixture({
        baseVersion: '1.0',
        buildNumber: 2,
        appVersion: '1.0.2',
        history: [
          entry2,
          {
            version: '1.0.1',
            date: '18/11/2026',
            title: 'Base inicial',
            details: ['Primeiro detalhe'],
          },
        ],
        sections: [
          {
            series: '1.0',
            rangeStart: '1.0.1',
            rangeEnd: '1.0.2',
            entries: [
              {
                version: '1.0.2',
                date: '19/11/2026',
                title: 'Título oficial',
                details: ['Detalhe A', 'Detalhe B'],
              },
            ],
          },
        ],
      });
      expect(() => {
        validateReleaseMetadata(extraBuildInHistoryFixture);
      }).toThrow(/não termina no build \.1|Quantidade de builds diverge/);

      const countMismatchFixture = makeFixture({
        baseVersion: '1.1',
        buildNumber: 1,
        appVersion: '1.1.1',
        history: [
          {
            version: '1.1.1',
            date: '20/11/2026',
            title: 'Série 1.1',
            details: ['Apenas um item no history.'],
          },
        ],
        sections: [
          {
            series: '1.1',
            entries: [
              {
                version: '1.1.1',
                date: '20/11/2026',
                title: 'Série 1.1',
                details: ['Apenas um item no history.'],
              },
            ],
          },
          {
            series: '1.0',
            entries: [entry1],
          },
        ],
      });
      expect(() => {
        validateReleaseMetadata(countMismatchFixture);
      }).toThrow(/Quantidade de builds diverge/);
    });

    it('7. rejeita data fora do formato DD/MM/AAAA, data inválida no calendário e data regressiva', () => {
      const isoDateFixture = makeFixture({
        baseVersion: '1.0',
        buildNumber: 1,
        appVersion: '1.0.1',
        sections: [
          {
            series: '1.0',
            entries: [
              {
                version: '1.0.1',
                date: '2026-11-18',
                title: 'Data ISO',
                details: ['Formato incorreto.'],
              },
            ],
          },
        ],
      });
      expect(() => {
        validateReleaseMetadata(isoDateFixture);
      }).toThrow(/esperado formato DD\/MM\/AAAA/);

      const invalidCalendarFixture = makeFixture({
        baseVersion: '1.0',
        buildNumber: 1,
        appVersion: '1.0.1',
        sections: [
          {
            series: '1.0',
            entries: [
              {
                version: '1.0.1',
                date: '31/02/2026',
                title: 'Fevereiro inválido',
                details: ['Dia não existe no calendário.'],
              },
            ],
          },
        ],
      });
      expect(() => {
        validateReleaseMetadata(invalidCalendarFixture);
      }).toThrow(/data inexistente no calendário/);

      const regressiveDateFixture = makeFixture({
        baseVersion: '1.0',
        buildNumber: 2,
        appVersion: '1.0.2',
        sections: [
          {
            series: '1.0',
            entries: [
              {
                version: '1.0.2',
                date: '17/11/2026',
                title: 'Build novo com data antiga',
                details: ['Data menor que a do build 1.0.1.'],
              },
              {
                version: '1.0.1',
                date: '18/11/2026',
                title: 'Build antigo com data futura',
                details: ['Inconsistência cronológica.'],
              },
            ],
          },
        ],
      });
      expect(() => {
        validateReleaseMetadata(regressiveDateFixture);
      }).toThrow(/Ordem cronológica regressiva/);
    });

    it('8. rejeita séries fora da ordem numérica decrescente estrita', () => {
      const ascendingSeriesFixture = makeFixture({
        baseVersion: '1.0',
        buildNumber: 1,
        appVersion: '1.0.1',
        sections: [
          {
            series: '1.0',
            entries: [
              {
                version: '1.0.1',
                date: '20/11/2026',
                title: 'Série 1.0 no topo',
                details: ['Ordem invertida.'],
              },
            ],
          },
          {
            series: '1.1',
            entries: [
              {
                version: '1.1.1',
                date: '18/11/2026',
                title: 'Série 1.1 abaixo',
                details: ['Deveria vir antes da 1.0.'],
              },
            ],
          },
        ],
      });
      expect(() => {
        validateReleaseMetadata(ascendingSeriesFixture);
      }).toThrow(/Séries fora de ordem numérica decrescente estrita/);

      const lexicographicTrapFixture = makeFixture({
        baseVersion: '1.9',
        buildNumber: 1,
        appVersion: '1.9.1',
        sections: [
          {
            series: '1.9',
            entries: [
              {
                version: '1.9.1',
                date: '21/11/2026',
                title: 'Série 1.9 antes de 1.10',
                details: ['Ordem lexicográfica errada.'],
              },
            ],
          },
          {
            series: '1.10',
            entries: [
              {
                version: '1.10.1',
                date: '20/11/2026',
                title: 'Série 1.10',
                details: ['Deveria vir antes da 1.9.'],
              },
            ],
          },
        ],
      });
      expect(() => {
        validateReleaseMetadata(lexicographicTrapFixture);
      }).toThrow(/Séries fora de ordem numérica decrescente estrita/);
    });
  });
});
