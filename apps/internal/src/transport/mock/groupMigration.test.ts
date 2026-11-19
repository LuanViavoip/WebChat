import { describe, expect, it } from 'vitest';
import { createSeedState, ICS_TENANT_ID, ICS_USERS } from './seed';
import { fromPersisted, PERSIST_VERSION, toPersisted } from './state';
import { MockServer } from './MockServer';
import { ICS_ILHAS } from './seed';

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

  it('ao alterar ilha pré-existente da v5, cria e sincroniza o grupo automático ausente', () => {
    const raw = toPersisted(createSeedState('2026-11-13T12:00:00.000Z'));
    for (const tenant of raw.tenants) {
      tenant.conversations = Object.fromEntries(Object.entries(tenant.conversations).filter(([, c]) => c.kind !== 'group'));
      tenant.createdAt = Object.fromEntries(Object.entries(tenant.createdAt).filter(([id]) => Object.hasOwn(tenant.conversations, id)));
      tenant.messages = Object.fromEntries(Object.entries(tenant.messages).filter(([id]) => Object.hasOwn(tenant.conversations, id)));
    }
    const state = fromPersisted({ ...raw, version: 5 });
    if (!state) throw new Error('estado não carregou');
    const server = new MockServer(state);
    const changed = server.addAgentToIlha({ tenantId: ICS_TENANT_ID, userId: ICS_USERS.marcos }, { ilhaId: ICS_ILHAS.exames, userId: ICS_USERS.ana });
    expect(changed.result.ok).toBe(true);
    const groups = Object.values(server.getState().get(ICS_TENANT_ID)?.conversations ?? {});
    expect(groups).toContainEqual(expect.objectContaining({ origin: { kind: 'ilha', ilhaId: ICS_ILHAS.exames }, members: expect.arrayContaining([ICS_USERS.ana, ICS_USERS.rafael]) }));
    expect(changed.deliveries).toContainEqual(expect.objectContaining({ event: expect.objectContaining({ type: 'message' }) }));
  });
});
