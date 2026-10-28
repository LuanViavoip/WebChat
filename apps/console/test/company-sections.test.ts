import { describe, expect, it } from 'vitest';
import { qualitySearch } from '../src/admin/company-desk.js';
import { sectionsFor } from '../src/shell/roles.js';

describe('seções da fase 5', () => {
  it('mostra administração só para o admin e qualidade para a supervisão', () => {
    expect(sectionsFor('agent').map((section) => section.id)).not.toContain('company');
    expect(sectionsFor('agent').map((section) => section.id)).not.toContain('quality');
    expect(sectionsFor('supervisor').map((section) => section.id)).toContain('quality');
    expect(sectionsFor('supervisor').map((section) => section.id)).not.toContain('company');
    expect(sectionsFor('admin').map((section) => section.id)).toEqual(
      expect.arrayContaining(['company', 'quality']),
    );
  });

  it('repete o mesmo request na query de qualidade', () => {
    const sectorId = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaa16';
    const search = qualitySearch({
      scope: { kind: 'sector', sectorId },
      from: '2026-10-01T00:00:00.000Z',
      to: '2026-10-02T00:00:00.000Z',
    });
    expect(search).toContain('scopeKind=sector');
    expect(search).toContain(`sectorId=${sectorId}`);
    expect(search).not.toContain('queueId');
  });
});
