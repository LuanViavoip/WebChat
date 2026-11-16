import { validateDirectory } from '@viavoip/internal-domain';
import { conversationTier } from '@viavoip/internal-domain';
import type { TenantId } from '@viavoip/internal-domain';
import { fromPersisted, toPersisted, type TenantState } from './state';
import {
  bvDirectory,
  BV_TENANT_ID,
  createSeedState,
  DEFAULT_SESSION,
  ICS_TENANT_ID,
  ICS_USERS,
  icsDirectory,
  LIVE_CONVERSATION_ID,
  OTHER_CONVERSATION_ID,
} from './seed';

describe('seed', () => {
  it('validateDirectory passa nos dois tenants', () => {
    expect(validateDirectory(icsDirectory()).ok).toBe(true);
    expect(validateDirectory(bvDirectory()).ok).toBe(true);
    for (const ts of createSeedState('2026-11-13T12:00:00.000Z').values()) {
      expect(validateDirectory(ts.directory).ok).toBe(true);
    }
  });

  it('tem as duas empresas, com fusos diferentes e um admin cada', () => {
    const state = createSeedState('2026-11-13T12:00:00.000Z');
    expect(state.get(ICS_TENANT_ID)?.tenant).toEqual({
      id: ICS_TENANT_ID,
      name: 'ICS Saúde',
      timeZone: 'America/Sao_Paulo',
    });
    expect(state.get(BV_TENANT_ID)?.tenant).toEqual({
      id: BV_TENANT_ID,
      name: 'Clínica Boa Vista',
      timeZone: 'America/Manaus',
    });
    for (const ts of state.values()) {
      const roles = Object.values(ts.directory.users).map((user) => user.role);
      expect(roles.filter((role) => role === 'admin')).toHaveLength(1);
    }
  });

  it('ICS: Carla supervisiona Norte e Sul, Rafael supervisiona Exames, dois agentes por ilha', () => {
    const { users, ilhas } = icsDirectory();
    expect(Object.values(ilhas).map((ilha) => [ilha.name, ilha.supervisorId])).toEqual([
      ['Norte', ICS_USERS.carla],
      ['Sul', ICS_USERS.carla],
      ['Exames', ICS_USERS.rafael],
    ]);
    for (const ilha of Object.values(ilhas)) {
      const agents = Object.values(users).filter((user) => user.role === 'agent' && user.ilhaId === ilha.id);
      expect(agents).toHaveLength(2);
    }
    expect(users[ICS_USERS.marcos]?.name).toBe('Marcos Dono');
  });

  it('BV: admin, um supervisor e dois agentes', () => {
    const roles = Object.values(bvDirectory().users).map((user) => user.role);
    expect(roles.sort()).toEqual(['admin', 'agent', 'agent', 'supervisor']);
  });

  it('todos os ids são do próprio tenant e nenhum id é compartilhado entre empresas', () => {
    const state = createSeedState('2026-11-13T12:00:00.000Z');
    const seen = new Set<string>();
    for (const [tenantId, ts] of state) {
      const ids = [
        ...Object.keys(ts.directory.users),
        ...Object.keys(ts.conversations),
        ...Object.values(ts.messages).flatMap((list) => list.map((message) => message.id)),
      ];
      for (const id of ids) {
        expect(seen.has(id), id).toBe(false);
        seen.add(id);
      }
      for (const conversation of Object.values(ts.conversations)) {
        expect(conversation.tenantId).toBe(tenantId);
      }
      for (const list of Object.values(ts.messages)) {
        expect(list.every((message) => message.tenantId === tenantId)).toBe(true);
      }
    }
  });

  it('a lista não nasce vazia: diretas com texto (agente↔supervisora e agente↔agente) na empresa A', () => {
    const ics = createSeedState('2026-11-13T12:00:00.000Z').get(ICS_TENANT_ID);
    if (!ics) {
      throw new Error('seed sem a empresa A');
    }
    const withMessages = Object.values(ics.conversations).filter((c) => (ics.messages[c.id] ?? []).length > 0);
    expect(withMessages.length).toBeGreaterThanOrEqual(3);
    const carla = ics.directory.users[ICS_USERS.carla];
    if (!carla) {
      throw new Error('seed sem a Carla');
    }
    const tiers = withMessages.map((c) => conversationTier(c, carla, ics.directory));
    expect(tiers).toContain('priority');
    const agentToAgent = Object.values(ics.conversations).some(
      (c) =>
        c.kind === 'direct' &&
        c.participants.every((id) => ics.directory.users[id]?.role === 'agent') &&
        (ics.messages[c.id] ?? []).length > 0,
    );
    expect(agentToAgent).toBe(true);
  });

  it('a conversa ao vivo e a segunda direta existem e a sessão padrão é da Carla', () => {
    const ics = createSeedState('2026-11-13T12:00:00.000Z').get(ICS_TENANT_ID);
    expect(DEFAULT_SESSION).toEqual({ tenantId: ICS_TENANT_ID, userId: ICS_USERS.carla });
    expect(ics?.conversations[LIVE_CONVERSATION_ID]?.kind).toBe('direct');
    expect(ics?.messages[LIVE_CONVERSATION_ID]).toEqual([]);
    expect(ics?.conversations[OTHER_CONVERSATION_ID]?.kind).toBe('direct');
  });

  it('sobrevive a ida e volta pelo formato serializável', () => {
    const state = createSeedState('2026-11-13T12:00:00.000Z');
    const back = fromPersisted(JSON.parse(JSON.stringify(toPersisted(state))));
    expect(back).toBeDefined();
    expect(toPersisted(back ?? new Map<TenantId, TenantState>())).toEqual(toPersisted(state));
  });

  it('fromPersisted recusa versão errada, diretório inválido e lixo', () => {
    const good = toPersisted(createSeedState('2026-11-13T12:00:00.000Z'));
    expect(fromPersisted({ ...good, version: 1 })).toBeUndefined();
    expect(fromPersisted(null)).toBeUndefined();
    expect(fromPersisted('x')).toBeUndefined();
    expect(fromPersisted({ version: 2, tenants: [] })).toBeUndefined();
    const corrupted = JSON.parse(JSON.stringify(good)) as typeof good;
    const first = corrupted.tenants[0];
    if (!first) {
      throw new Error('seed vazia');
    }
    const user = first.directory.users[ICS_USERS.ana];
    if (!user) {
      throw new Error('seed sem a Ana');
    }
    user.grants = ['admin.console'];
    expect(fromPersisted(corrupted)).toBeUndefined();
  });
});
