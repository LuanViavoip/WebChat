import type { Role } from '@viavoip/protocol';
import { describe, expect, it } from 'vitest';
import { navGroups, sectionSlugs } from '../src/shell/nav.js';
import { sectionsFor } from '../src/shell/roles.js';

const roles: Role[] = ['agent', 'supervisor', 'admin'];

describe('navGroups', () => {
  it.each(roles)('inclui exatamente as seções de sectionsFor para %s', (role) => {
    const grouped = navGroups(role).flatMap((group) => group.items.map((item) => item.id));
    expect([...grouped].sort()).toEqual(sectionsFor(role).map((item) => item.id).sort());
  });

  it('mantém os rótulos de sectionsFor e preserva a ordem dentro do grupo', () => {
    const labels = navGroups('admin').flatMap((group) => group.items.map((item) => item.label));
    expect(labels).toContain('Administração');
    expect(labels).toContain('Atendimentos');
    const desk = navGroups('admin').find((group) => group.id === 'atendimento');
    expect(desk?.items.map((item) => item.id)).toEqual(['desk', 'internal']);
  });

  it('não mostra Administração para agente nem supervisor', () => {
    for (const role of ['agent', 'supervisor'] as const) {
      expect(navGroups(role).flatMap((group) => group.items.map((item) => item.label))).not.toContain('Administração');
    }
  });

  it('aplica o badge de não lidas só ao chat interno', () => {
    const items = navGroups('agent', { internal: 3 }).flatMap((group) => group.items);
    expect(items.find((item) => item.id === 'internal')?.badge).toBe(3);
    expect(items.find((item) => item.id === 'desk')?.badge).toBeUndefined();
  });
});

describe('sectionSlugs', () => {
  it('tem um slug único por seção', () => {
    const slugs = Object.values(sectionSlugs);
    expect(new Set(slugs).size).toBe(slugs.length);
  });
});
