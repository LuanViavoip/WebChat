import { describe, expect, it } from 'vitest';
import { retrySameRequest } from '../src/admin/company-desk.js';

describe('retry do comando da empresa', () => {
  it('repete o mesmo pedido depois do timeout e não repete erro definitivo', async () => {
    const requestId = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaa31';
    const seen: string[] = [];
    let calls = 0;
    const value = await retrySameRequest(
      async (signal) => {
        calls += 1;
        seen.push(requestId);
        if (calls === 1) {
          await new Promise((_, reject) => {
            signal.addEventListener('abort', () => {
              const error = new Error('tempo esgotado');
              error.name = 'AbortError';
              reject(error);
            });
          });
        }
        return { requestId, calls };
      },
      { attempts: 2, timeoutMs: 20 },
    );
    expect(value).toEqual({ requestId, calls: 2 });
    expect(seen).toEqual([requestId, requestId]);

    let forbidden = 0;
    await expect(
      retrySameRequest(async () => {
        forbidden += 1;
        throw Object.assign(new Error('Gestão exclusiva do administrador'), { name: 'Error' });
      }, { attempts: 2, timeoutMs: 20 }),
    ).rejects.toThrow('Gestão exclusiva do administrador');
    expect(forbidden).toBe(1);
  });
});