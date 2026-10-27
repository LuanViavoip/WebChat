import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

function serverPackageRoot(): string {
  const candidates = [path.resolve(here, '..'), path.resolve(here, '..', '..'), process.cwd()];
  for (const candidate of candidates) {
    if (existsSync(path.join(candidate, 'migrations'))) return candidate;
  }
  throw new Error('Não encontrei o diretório de migrations do servidor');
}

export const serverRoot = serverPackageRoot();
export const repoRoot = path.resolve(serverRoot, '..', '..');
export const migrationsDirectory = path.join(serverRoot, 'migrations');
export const seedFile = path.join(repoRoot, 'infra', 'seed', 'seed.sql');
export const widgetDist = path.join(repoRoot, 'apps', 'widget', 'dist');
export const consoleDist = path.join(repoRoot, 'apps', 'console', 'dist');
