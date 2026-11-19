import { describe, expect, it } from 'vitest';
import { createSeedState, ICS_TENANT_ID, ICS_USERS } from './seed';
import { fromPersisted, PERSIST_VERSION, toPersisted } from './state';

describe('migração dos grupos da v5 para a v6', () => {
  it('mantém grupos e inicializa ex-membros sem alterar o dado original', () => {
    const raw = toPersisted(createSeedState('2026-11-13T12:00:00.000Z'));
    const tenant = raw.tenants.find((item) => item.tenant.id === ICS_TENANT_ID);
    if (!tenant) throw new Error('tenant ausente');
    Object.assign(tenant.conversations, { 'grp:1': { kind: 'group', id: 'grp:1', tenantId: ICS_TENANT_ID, title: 'Grupo', origin: { kind: 'custom', createdBy: ICS_USERS.carla }, members: [ICS_USERS.carla], createdAt: '2026-11-13T12:00:00.000Z' } });
    Object.assign(tenant.createdAt, { 'grp:1': '2026-11-13T12:00:00.000Z' });
    const legacy: unknown = { ...raw, version: 5 };
    const migrated = fromPersisted(legacy)?.get(ICS_TENANT_ID)?.conversations['grp:1' as never];
    expect(PERSIST_VERSION).toBe(6);
    expect(migrated).toMatchObject({ kind: 'group', formerMemberIds: [] });
    expect(tenant.conversations['grp:1' as never]).not.toHaveProperty('formerMemberIds');
  });
});
