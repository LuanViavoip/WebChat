import { afterEach, describe, expect, it, vi } from 'vitest';
import { uuidv4 } from '../src/uuid.js';

const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

describe('uuidv4', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('gera UUID v4 válido sem crypto.randomUUID (contexto HTTP inseguro)', () => {
    vi.stubGlobal('crypto', { getRandomValues: globalThis.crypto.getRandomValues.bind(globalThis.crypto) });
    const ids = new Set(Array.from({ length: 200 }, () => uuidv4()));
    expect(ids.size).toBe(200);
    for (const id of ids) expect(id).toMatch(uuidRegex);
  });
});
