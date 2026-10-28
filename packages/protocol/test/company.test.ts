import { describe, expect, it } from 'vitest';
import {
  auditActionSchema,
  companyCommandSchema,
  companyDeskSchema,
  configuredAcceptanceSchema,
  qualityReportQuerySchema,
  serviceCalendarSchema,
} from '../src/index.js';

const agentId = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaa01';
const queueId = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaa02';

describe('contrato administrativo', () => {
  it('aceita a criação de um agente e recusa tenantId', () => {
    const command = {
      kind: 'agent.create' as const,
      email: 'Nova@Tenant-A.Local',
      name: 'Nova',
      password: 'senha-inicial-12',
      placement: {
        role: 'agent' as const,
        queueIds: [queueId],
        activityAuthority: { kind: 'assigned_only' as const },
      },
    };
    expect(companyCommandSchema.parse(command).kind).toBe('agent.create');
    const parsed = companyCommandSchema.parse(command);
    if (parsed.kind === 'agent.create') expect(parsed.email).toBe('nova@tenant-a.local');
    expect(companyCommandSchema.safeParse({ ...command, tenantId: agentId }).success).toBe(false);
  });

  it('recusa pausa sem motivo e janela invertida ou sobreposta', () => {
    expect(configuredAcceptanceSchema.safeParse({ kind: 'paused' }).success).toBe(false);
    expect(
      serviceCalendarSchema.safeParse({
        kind: 'weekly',
        windows: [{ weekday: 1, startMinute: 600, endMinute: 540 }],
      }).success,
    ).toBe(false);
    expect(
      serviceCalendarSchema.safeParse({
        kind: 'weekly',
        windows: [
          { weekday: 1, startMinute: 540, endMinute: 720 },
          { weekday: 1, startMinute: 700, endMinute: 800 },
        ],
      }).success,
    ).toBe(false);
  });

  it('traduz o escopo da qualidade e limita a janela a 31 dias', () => {
    expect(
      qualityReportQuerySchema.parse({
        scopeKind: 'sector',
        sectorId: agentId,
        from: '2026-10-01T00:00:00.000Z',
        to: '2026-10-28T00:00:00.000Z',
      }).scope,
    ).toEqual({ kind: 'sector', sectorId: agentId });
    expect(
      qualityReportQuerySchema.safeParse({
        scopeKind: 'tenant',
        from: '2026-10-01T00:00:00.000Z',
        to: '2026-11-02T00:00:00.000Z',
      }).success,
    ).toBe(false);
    expect(
      qualityReportQuerySchema.safeParse({
        scopeKind: 'queue',
        from: '2026-10-01T00:00:00.000Z',
        to: '2026-10-02T00:00:00.000Z',
      }).success,
    ).toBe(false);
  });

  it('guarda ação de auditoria desconhecida sem tratar como booleano', () => {
    expect(auditActionSchema.parse({ kind: 'unrecognized', raw: 'legacy.action' })).toEqual({
      kind: 'unrecognized',
      raw: 'legacy.action',
    });
    expect(
      companyDeskSchema.safeParse({
        company: {
          name: 'A',
          slug: 'a',
          timeZone: 'America/Sao_Paulo',
          concurrencyLimit: 3,
          internalHistory: { policy: 'retain_until_removed' },
          active: true,
        },
      }).success,
    ).toBe(false);
  });
});
