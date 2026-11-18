import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

type ReleaseNoteRecord = {
  readonly version: string;
  readonly date: string;
  readonly title: string;
  readonly details: readonly string[];
};

type ParsedVersionTsState = {
  readonly baseVersion: string;
  readonly buildNumber: number;
  readonly history: readonly ReleaseNoteRecord[];
};

type ExecFailure = {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
};

const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(scriptsDir, '..');
const sourceScriptPath = path.join(appRoot, 'scripts', 'bump-version.mjs');
const sourceVersionTsPath = path.join(appRoot, 'src', 'version.ts');
const sourceReleaseNotesPath = path.join(appRoot, 'RELEASE_NOTES.md');

function getTodaySaoPaulo(): string {
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(new Date());
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseReleaseNoteRecord(value: unknown, index: number): ReleaseNoteRecord {
  if (!isRecord(value)) {
    throw new Error(`Entrada de histórico [${String(index)}] não é um objeto.`);
  }
  const { version, date, title, details } = value;
  if (
    typeof version !== 'string' ||
    typeof date !== 'string' ||
    typeof title !== 'string' ||
    !Array.isArray(details) ||
    details.some((item) => typeof item !== 'string')
  ) {
    throw new Error(`Entrada de histórico [${String(index)}] possui campos inválidos.`);
  }
  return {
    version,
    date,
    title,
    details: details.filter((item): item is string => typeof item === 'string'),
  };
}

function readVersionTsState(filePath: string): ParsedVersionTsState {
  const content = fs.readFileSync(filePath, 'utf8');
  const baseMatch = /^export\s+const\s+APP_BASE_VERSION\s*=\s*'([^']+)';/m.exec(content);
  const buildMatch = /^export\s+const\s+APP_BUILD_NUMBER\s*=\s*(\d+);/m.exec(content);
  const baseVersion = baseMatch?.[1];
  const buildRaw = buildMatch?.[1];
  if (baseVersion === undefined || buildRaw === undefined) {
    throw new Error(`Não foi possível ler APP_BASE_VERSION/APP_BUILD_NUMBER de ${filePath}`);
  }

  const beginMarker = '/* @bump-begin */';
  const endMarker = '/* @bump-end */';
  const beginIdx = content.indexOf(beginMarker);
  const endIdx = content.indexOf(endMarker);
  if (beginIdx === -1 || endIdx === -1 || beginIdx >= endIdx) {
    throw new Error(`Marcadores @bump-begin/@bump-end ausentes em ${filePath}`);
  }

  const rawJson = content.slice(beginIdx + beginMarker.length, endIdx);
  const parsedJson: unknown = JSON.parse(rawJson);
  if (!Array.isArray(parsedJson)) {
    throw new Error(`RELEASE_NOTES_HISTORY em ${filePath} não é um array.`);
  }

  return {
    baseVersion,
    buildNumber: Number(buildRaw),
    history: parsedJson.map((item, idx) => parseReleaseNoteRecord(item, idx)),
  };
}

function nextMinorSeries(series: string): string {
  const parts = series.split('.');
  const major = Number(parts[0] ?? '1');
  const minor = Number(parts[1] ?? '0');
  return `${String(major)}.${String(minor + 1)}`;
}

function extractOutputText(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  if (Buffer.isBuffer(value)) {
    return value.toString('utf8');
  }
  return '';
}

describe('scripts/bump-version.mjs', () => {
  let tmpDir = '';
  let tmpScriptPath = '';
  let tmpVersionTsPath = '';
  let tmpReleaseNotesPath = '';

  function runBump(args: readonly string[]): string {
    return execFileSync(process.execPath, [tmpScriptPath, ...args], {
      cwd: tmpDir,
      encoding: 'utf8',
      stdio: 'pipe',
    });
  }

  function runBumpExpectFailure(args: readonly string[]): ExecFailure {
    try {
      execFileSync(process.execPath, [tmpScriptPath, ...args], {
        cwd: tmpDir,
        encoding: 'utf8',
        stdio: 'pipe',
      });
    } catch (error: unknown) {
      if (isRecord(error)) {
        return {
          status: typeof error.status === 'number' ? error.status : null,
          stdout: extractOutputText(error.stdout),
          stderr: extractOutputText(error.stderr),
        };
      }
      throw error;
    }
    throw new Error(`Esperava código de saída diferente de 0 para [${args.join(', ')}].`);
  }

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'viavoip-bump-version-'));
    fs.mkdirSync(path.join(tmpDir, 'scripts'), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, 'src'), { recursive: true });

    tmpScriptPath = path.join(tmpDir, 'scripts', 'bump-version.mjs');
    tmpVersionTsPath = path.join(tmpDir, 'src', 'version.ts');
    tmpReleaseNotesPath = path.join(tmpDir, 'RELEASE_NOTES.md');

    fs.copyFileSync(sourceScriptPath, tmpScriptPath);
    fs.copyFileSync(sourceVersionTsPath, tmpVersionTsPath);
    fs.copyFileSync(sourceReleaseNotesPath, tmpReleaseNotesPath);
  });

  afterEach(() => {
    if (tmpDir !== '') {
      fs.rmSync(tmpDir, { recursive: true, force: true });
      tmpDir = '';
    }
  });

  it('1. --check sai com código 0 no estado inicial copiado', () => {
    const stdout = runBump(['--check']);
    const state = readVersionTsState(tmpVersionTsPath);
    const currentVersion = `${state.baseVersion}.${String(state.buildNumber)}`;

    expect(stdout).toContain('OK: version.ts e RELEASE_NOTES.md consistentes');
    expect(stdout).toContain(currentVersion);
  });

  it('2. bump normal incrementa BUILD, atualiza cabeçalho, faixa, bloco no topo e RELEASE_NOTES_HISTORY, e passa em --check', () => {
    const beforeState = readVersionTsState(tmpVersionTsPath);
    const prevVersion = `${beforeState.baseVersion}.${String(beforeState.buildNumber)}`;
    const nextBuild = beforeState.buildNumber + 1;
    const nextVersion = `${beforeState.baseVersion}.${String(nextBuild)}`;
    const today = getTodaySaoPaulo();

    const stdout = runBump(['Nova funcionalidade', 'Detalhe um', 'Detalhe dois']);
    expect(stdout).toContain(`Versão atualizada: ${prevVersion} -> ${nextVersion}`);

    const afterState = readVersionTsState(tmpVersionTsPath);
    expect(afterState.baseVersion).toBe(beforeState.baseVersion);
    expect(afterState.buildNumber).toBe(nextBuild);
    expect(afterState.history).toHaveLength(beforeState.history.length + 1);
    expect(afterState.history[0]).toEqual({
      version: nextVersion,
      date: today,
      title: 'Nova funcionalidade',
      details: ['Detalhe um', 'Detalhe dois'],
    });
    expect(afterState.history.slice(1)).toEqual(beforeState.history);

    const md = fs.readFileSync(tmpReleaseNotesPath, 'utf8');
    expect(md).toContain(`> **Versão Atual de Compilação:** \`${nextVersion}\``);
    expect(md).toContain(`> **Série Base Atual:** \`${beforeState.baseVersion}\``);
    expect(md).toContain(`> **Última Atualização:** \`${today}\``);
    expect(md).toContain(
      `## 📦 Histórico de Alterações — Série \`${beforeState.baseVersion}\` (\`${beforeState.baseVersion}.1\` a \`${nextVersion}\`)`,
    );

    const expectedTopBlock = [
      `### Build \`${nextVersion}\` — *${today}*`,
      '**Nova funcionalidade**',
      '- Detalhe um',
      '- Detalhe dois',
    ].join('\n');
    const newBlockPos = md.indexOf(expectedTopBlock);
    const oldBlockPos = md.indexOf(`### Build \`${prevVersion}\``);
    expect(newBlockPos).toBeGreaterThan(-1);
    expect(oldBlockPos).toBeGreaterThan(newBlockPos);

    const checkOut = runBump(['--check']);
    expect(checkOut).toContain(`versão atual: ${nextVersion}`);
  });

  it('3. --remix inicia nova série em .1 acima da série anterior separada por --- preservando histórico e passando em --check', () => {
    const beforeState = readVersionTsState(tmpVersionTsPath);
    const prevVersion = `${beforeState.baseVersion}.${String(beforeState.buildNumber)}`;
    const remixSeries = nextMinorSeries(beforeState.baseVersion);
    const remixVersion = `${remixSeries}.1`;
    const today = getTodaySaoPaulo();

    const stdout = runBump([
      '--remix',
      remixSeries,
      `Início da série ${remixSeries}`,
      `Primeiro recurso da ${remixSeries}`,
    ]);
    expect(stdout).toContain(`Versão atualizada: ${prevVersion} -> ${remixVersion}`);

    const afterState = readVersionTsState(tmpVersionTsPath);
    expect(afterState.baseVersion).toBe(remixSeries);
    expect(afterState.buildNumber).toBe(1);
    expect(afterState.history).toHaveLength(beforeState.history.length + 1);
    expect(afterState.history[0]).toEqual({
      version: remixVersion,
      date: today,
      title: `Início da série ${remixSeries}`,
      details: [`Primeiro recurso da ${remixSeries}`],
    });
    expect(afterState.history.slice(1)).toEqual(beforeState.history);

    const md = fs.readFileSync(tmpReleaseNotesPath, 'utf8');
    expect(md).toContain(`> **Versão Atual de Compilação:** \`${remixVersion}\``);
    expect(md).toContain(`> **Série Base Atual:** \`${remixSeries}\``);
    expect(md).toContain(`> **Última Atualização:** \`${today}\``);

    const newSectionHeader = `## 📦 Histórico de Alterações — Série \`${remixSeries}\` (\`${remixVersion}\` a \`${remixVersion}\`)`;
    const prevSectionHeader = `## 📦 Histórico de Alterações — Série \`${beforeState.baseVersion}\``;
    const newSectionIdx = md.indexOf(newSectionHeader);
    const prevSectionIdx = md.indexOf(prevSectionHeader);

    expect(newSectionIdx).toBeGreaterThan(-1);
    expect(prevSectionIdx).toBeGreaterThan(newSectionIdx);

    const betweenSections = md.slice(newSectionIdx, prevSectionIdx);
    expect(betweenSections).toContain('\n\n---\n\n');
    expect(md).toContain(`### Build \`${prevVersion}\``);

    const checkOut = runBump(['--check']);
    expect(checkOut).toContain(`versão atual: ${remixVersion}`);
  });

  it('4. --from-pending com 2 itens aplica ambos em ordem, coloca o segundo no topo, passa em --check e remove o JSON', () => {
    const beforeState = readVersionTsState(tmpVersionTsPath);
    const prevVersion = `${beforeState.baseVersion}.${String(beforeState.buildNumber)}`;
    const firstNewVersion = `${beforeState.baseVersion}.${String(beforeState.buildNumber + 1)}`;
    const secondNewBuild = beforeState.buildNumber + 2;
    const secondNewVersion = `${beforeState.baseVersion}.${String(secondNewBuild)}`;
    const today = getTodaySaoPaulo();

    const pendingPath = path.join(tmpDir, 'pending.json');
    fs.writeFileSync(
      pendingPath,
      JSON.stringify(
        [
          {
            title: 'Primeira entrega da frente',
            details: ['Detalhe da primeira entrega.'],
          },
          {
            title: 'Segunda entrega da frente',
            details: ['Detalhe A da segunda.', 'Detalhe B da segunda.'],
          },
        ],
        null,
        2,
      ),
      'utf8',
    );

    const stdout = runBump(['--from-pending', 'pending.json']);
    expect(stdout).toContain(
      `Versão atualizada: ${prevVersion} -> ${secondNewVersion} (2 builds aplicados).`,
    );
    expect(fs.existsSync(pendingPath)).toBe(false);

    const afterState = readVersionTsState(tmpVersionTsPath);
    expect(afterState.baseVersion).toBe(beforeState.baseVersion);
    expect(afterState.buildNumber).toBe(secondNewBuild);
    expect(afterState.history).toHaveLength(beforeState.history.length + 2);
    expect(afterState.history[0]).toEqual({
      version: secondNewVersion,
      date: today,
      title: 'Segunda entrega da frente',
      details: ['Detalhe A da segunda.', 'Detalhe B da segunda.'],
    });
    expect(afterState.history[1]).toEqual({
      version: firstNewVersion,
      date: today,
      title: 'Primeira entrega da frente',
      details: ['Detalhe da primeira entrega.'],
    });
    expect(afterState.history.slice(2)).toEqual(beforeState.history);

    const md = fs.readFileSync(tmpReleaseNotesPath, 'utf8');
    expect(md).toContain(
      `## 📦 Histórico de Alterações — Série \`${beforeState.baseVersion}\` (\`${beforeState.baseVersion}.1\` a \`${secondNewVersion}\`)`,
    );
    const secondPos = md.indexOf(`### Build \`${secondNewVersion}\``);
    const firstPos = md.indexOf(`### Build \`${firstNewVersion}\``);
    const prevPos = md.indexOf(`### Build \`${prevVersion}\``);
    expect(secondPos).toBeGreaterThan(-1);
    expect(firstPos).toBeGreaterThan(secondPos);
    expect(prevPos).toBeGreaterThan(firstPos);

    const checkOut = runBump(['--check']);
    expect(checkOut).toContain(`versão atual: ${secondNewVersion}`);
  });

  it('5. --check sai com código 1 quando RELEASE_NOTES.md ou src/version.ts está adulterado', () => {
    const originalMd = fs.readFileSync(tmpReleaseNotesPath, 'utf8');
    const tamperedMd = originalMd.replace(
      /(>\s*\*\*Versão Atual de Compilação:\*\*\s*`)[^`]+(`)/,
      '$19.9.9$2',
    );
    expect(tamperedMd).not.toBe(originalMd);
    fs.writeFileSync(tmpReleaseNotesPath, tamperedMd, 'utf8');

    const mdFailure = runBumpExpectFailure(['--check']);
    expect(mdFailure.status).toBe(1);
    expect(mdFailure.stderr).toContain('Cabeçalho Versão Atual de Compilação');

    fs.writeFileSync(tmpReleaseNotesPath, originalMd, 'utf8');
    const originalTs = fs.readFileSync(tmpVersionTsPath, 'utf8');
    const tamperedTs = originalTs.replace(
      /export const APP_BUILD_NUMBER = \d+;/,
      'export const APP_BUILD_NUMBER = 0;',
    );
    expect(tamperedTs).not.toBe(originalTs);
    fs.writeFileSync(tmpVersionTsPath, tamperedTs, 'utf8');

    const tsFailure = runBumpExpectFailure(['--check']);
    expect(tsFailure.status).toBe(1);
    expect(tsFailure.stderr).toContain('APP_BUILD_NUMBER inválido');
  });

  it('6. título vazio, só com espaços ou detalhe vazio falham com código 1 sem alterar arquivos', () => {
    const initialVersionTs = fs.readFileSync(tmpVersionTsPath, 'utf8');
    const initialReleaseNotes = fs.readFileSync(tmpReleaseNotesPath, 'utf8');

    const emptyTitleFailure = runBumpExpectFailure(['', 'Detalhe válido']);
    expect(emptyTitleFailure.status).toBe(1);
    expect(emptyTitleFailure.stderr).toContain('Título não pode ser vazio');
    expect(fs.readFileSync(tmpVersionTsPath, 'utf8')).toBe(initialVersionTs);
    expect(fs.readFileSync(tmpReleaseNotesPath, 'utf8')).toBe(initialReleaseNotes);

    const whitespaceTitleFailure = runBumpExpectFailure(['   ', 'Detalhe válido']);
    expect(whitespaceTitleFailure.status).toBe(1);
    expect(whitespaceTitleFailure.stderr).toContain('Título não pode ser vazio');
    expect(fs.readFileSync(tmpVersionTsPath, 'utf8')).toBe(initialVersionTs);
    expect(fs.readFileSync(tmpReleaseNotesPath, 'utf8')).toBe(initialReleaseNotes);

    const emptyDetailFailure = runBumpExpectFailure(['Título válido', '']);
    expect(emptyDetailFailure.status).toBe(1);
    expect(emptyDetailFailure.stderr).toContain('Detalhe 1 não pode ser vazio');
    expect(fs.readFileSync(tmpVersionTsPath, 'utf8')).toBe(initialVersionTs);
    expect(fs.readFileSync(tmpReleaseNotesPath, 'utf8')).toBe(initialReleaseNotes);
  });

  it('7. --dry-run não modifica src/version.ts nem RELEASE_NOTES.md e não apaga o JSON em --from-pending', () => {
    const initialVersionTs = fs.readFileSync(tmpVersionTsPath, 'utf8');
    const initialReleaseNotes = fs.readFileSync(tmpReleaseNotesPath, 'utf8');

    const dryBumpOut = runBump(['--dry-run', 'Teste dry run', 'Detalhe simulado']);
    expect(dryBumpOut).toContain('[dry-run]');
    expect(dryBumpOut).toContain('Nenhuma alteração gravada em disco.');
    expect(fs.readFileSync(tmpVersionTsPath, 'utf8')).toBe(initialVersionTs);
    expect(fs.readFileSync(tmpReleaseNotesPath, 'utf8')).toBe(initialReleaseNotes);

    const pendingPath = path.join(tmpDir, 'pending.json');
    const pendingContent = JSON.stringify(
      [
        {
          title: 'Item pendente simulado',
          details: ['Não deve apagar o arquivo nem editar disco.'],
        },
      ],
      null,
      2,
    );
    fs.writeFileSync(pendingPath, pendingContent, 'utf8');

    const dryPendingOut = runBump(['--dry-run', '--from-pending', 'pending.json']);
    expect(dryPendingOut).toContain('[dry-run] Arquivo pendente que seria removido:');
    expect(fs.existsSync(pendingPath)).toBe(true);
    expect(fs.readFileSync(pendingPath, 'utf8')).toBe(pendingContent);
    expect(fs.readFileSync(tmpVersionTsPath, 'utf8')).toBe(initialVersionTs);
    expect(fs.readFileSync(tmpReleaseNotesPath, 'utf8')).toBe(initialReleaseNotes);
  });

  it('8. --remix com série menor ou igual à atual falha com código 1 sem alterar arquivos', () => {
    const beforeState = readVersionTsState(tmpVersionTsPath);
    const initialVersionTs = fs.readFileSync(tmpVersionTsPath, 'utf8');
    const initialReleaseNotes = fs.readFileSync(tmpReleaseNotesPath, 'utf8');

    const failure = runBumpExpectFailure([
      '--remix',
      beforeState.baseVersion,
      'Tentativa inválida',
      'Série precisa ser estritamente maior.',
    ]);
    expect(failure.status).toBe(1);
    expect(failure.stderr).toContain('deve ser estritamente maior');
    expect(fs.readFileSync(tmpVersionTsPath, 'utf8')).toBe(initialVersionTs);
    expect(fs.readFileSync(tmpReleaseNotesPath, 'utf8')).toBe(initialReleaseNotes);
  });
});
