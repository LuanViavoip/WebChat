import type { CompanyCommand, CompanyCommandResult } from '@viavoip/protocol';
import { describe, expect, it } from 'vitest';
import { CommandRunner } from '../src/admin/command-runner.js';

const rename: CompanyCommand = { kind: 'company.rename', name: 'Empresa A' };

function result(requestId: string): CompanyCommandResult {
  return { requestId } as unknown as CompanyCommandResult;
}

function networkError(): Error {
  return Object.assign(new Error('Failed to fetch'), { name: 'TypeError' });
}

function refusal(): Error {
  return Object.assign(new Error('Gestão exclusiva do administrador'), { name: 'Error' });
}

describe('CommandRunner', () => {
  it('reaproveita o requestId quando o mesmo conteúdo é reenviado depois de falha retryável', async () => {
    const runner = new CommandRunner();
    const seen: string[] = [];
    await expect(
      runner.run(rename, async (_command, requestId) => {
        seen.push(requestId);
        throw networkError();
      }),
    ).rejects.toThrow('Failed to fetch');
    await runner.run(rename, async (_command, requestId) => {
      seen.push(requestId);
      return result(requestId);
    });
    expect(seen).toHaveLength(2);
    expect(seen[1]).toBe(seen[0]);
  });

  it('gera outro requestId depois de sucesso', async () => {
    const runner = new CommandRunner();
    const seen: string[] = [];
    const ok = async (_command: CompanyCommand, requestId: string) => {
      seen.push(requestId);
      return result(requestId);
    };
    await runner.run(rename, ok);
    await runner.run(rename, ok);
    expect(seen[1]).not.toBe(seen[0]);
    expect(runner.peek()).toBeNull();
  });

  it('gera outro requestId quando o conteúdo do formulário muda', async () => {
    const runner = new CommandRunner();
    const seen: string[] = [];
    const fail = async (_command: CompanyCommand, requestId: string): Promise<CompanyCommandResult> => {
      seen.push(requestId);
      throw networkError();
    };
    await expect(runner.run(rename, fail)).rejects.toThrow();
    await expect(runner.run({ kind: 'company.rename', name: 'Empresa B' }, fail)).rejects.toThrow();
    expect(seen[1]).not.toBe(seen[0]);
  });

  it('descarta o id depois de recusa definitiva do servidor', async () => {
    const runner = new CommandRunner();
    const seen: string[] = [];
    const deny = async (_command: CompanyCommand, requestId: string): Promise<CompanyCommandResult> => {
      seen.push(requestId);
      throw refusal();
    };
    await expect(runner.run(rename, deny)).rejects.toThrow('Gestão exclusiva');
    expect(runner.peek()).toBeNull();
    await expect(runner.run(rename, deny)).rejects.toThrow('Gestão exclusiva');
    expect(seen[1]).not.toBe(seen[0]);
  });

  it('ignora nova submissão enquanto há envio pendente', async () => {
    const runner = new CommandRunner();
    let release: () => void = () => {};
    let calls = 0;
    const first = runner.run(
      rename,
      (_command, requestId) =>
        new Promise<CompanyCommandResult>((resolve) => {
          calls += 1;
          release = () => resolve(result(requestId));
        }),
    );
    expect(runner.pending).toBe(true);
    const second = await runner.run(rename, async (_command, requestId) => {
      calls += 1;
      return result(requestId);
    });
    expect(second).toBeNull();
    release();
    await first;
    expect(calls).toBe(1);
    expect(runner.pending).toBe(false);
  });

  it('reset descarta a tentativa em aberto', async () => {
    const runner = new CommandRunner();
    const seen: string[] = [];
    const fail = async (_command: CompanyCommand, requestId: string): Promise<CompanyCommandResult> => {
      seen.push(requestId);
      throw networkError();
    };
    await expect(runner.run(rename, fail)).rejects.toThrow();
    expect(runner.peek()).toBe(seen[0]);
    runner.reset();
    await expect(runner.run(rename, fail)).rejects.toThrow();
    expect(seen[1]).not.toBe(seen[0]);
  });
});
