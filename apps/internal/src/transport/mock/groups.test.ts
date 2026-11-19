import { expect, it } from 'vitest';
import type { GroupConversation } from '@viavoip/internal-domain';
import { MockServer } from './MockServer';
import { createSeedState, ICS_TENANT_ID, ICS_USERS } from './seed';

it('cria grupo apenas aos membros, de forma idempotente, e conserva histórico do removido', () => {
  const server = new MockServer(createSeedState('2026-11-13T12:00:00.000Z'));
  const carla = { tenantId: ICS_TENANT_ID, userId: ICS_USERS.carla };
  const ana = { tenantId: ICS_TENANT_ID, userId: ICS_USERS.ana };
  const request = { clientId: 'teste', title: 'Equipe', memberIds: [ICS_USERS.carla, ICS_USERS.ana], ilhaId: null };
  const created = server.createGroup(carla, request);
  if (!created.result.ok) throw created.result.error;
  const id = created.result.value.id;
  expect(new Set(created.deliveries.map((d) => d.to))).toEqual(new Set(request.memberIds));
  expect(server.createGroup(carla, request).result).toEqual(created.result);
  const removed = server.updateGroup(carla, { conversationId: id, remove: [ICS_USERS.ana] });
  expect(removed.deliveries).toContainEqual(expect.objectContaining({ to: ICS_USERS.ana, event: expect.objectContaining({ type: 'conversation-removed' }) }));
  const bootstrap = server.connect(ana);
  if (!bootstrap.result.ok) throw bootstrap.result.error;
  expect(bootstrap.result.value.conversations).toContainEqual(expect.objectContaining({ id, readOnly: true }));
  expect(server.send(ana, { conversationId: id, clientId: 'negado', payload: { type: 'text', text: 'oi' } }).result.ok).toBe(false);
});

it('cria grupo automático ao criar ilha e sincroniza seus membros', () => {
  const server = new MockServer(createSeedState('2026-11-13T12:00:00.000Z'), { newId: () => 'nova' });
  const admin = { tenantId: ICS_TENANT_ID, userId: ICS_USERS.marcos };
  const created = server.createIlha(admin, { name: 'Nova', supervisorIds: [ICS_USERS.carla] });
  if (!created.result.ok) throw created.result.error;
  const ilhaId = created.result.value.id;
  const find = () => Object.values(server.getState().get(ICS_TENANT_ID)?.conversations ?? {}).find((c) => c.kind === 'group' && c.origin.kind === 'ilha' && c.origin.ilhaId === ilhaId);
  expect(find()).toMatchObject({ members: [ICS_USERS.carla] });
  const added = server.addAgentToIlha(admin, { ilhaId, userId: ICS_USERS.ana });
  expect(added.result.ok).toBe(true);
  expect(find()).toMatchObject({ members: expect.arrayContaining([ICS_USERS.carla, ICS_USERS.ana]) });
  expect(added.deliveries).toContainEqual(expect.objectContaining({ event: expect.objectContaining({ type: 'message' }) }));
  const removed = server.removeAgentFromIlha(admin, { ilhaId, userId: ICS_USERS.ana });
  expect(removed.deliveries).toContainEqual(expect.objectContaining({ to: ICS_USERS.ana, event: expect.objectContaining({ type: 'conversation-removed' }) }));
  expect(server.assignIlhaSupervisor(admin, { ilhaId, supervisorId: ICS_USERS.rafael }).result.ok).toBe(true);
  expect(find()).toMatchObject({ members: expect.arrayContaining([ICS_USERS.carla, ICS_USERS.rafael]) });
  const unassigned = server.unassignIlhaSupervisor(admin, { ilhaId, supervisorId: ICS_USERS.rafael });
  expect(unassigned.result.ok).toBe(true);
  expect(unassigned.deliveries).toContainEqual(expect.objectContaining({ to: ICS_USERS.rafael, event: expect.objectContaining({ type: 'conversation-removed' }) }));
});

it('não revela as mensagens enviadas durante uma ausência após o retorno', () => {
  const server = new MockServer(createSeedState('2026-11-13T12:00:00.000Z'));
  const carla = { tenantId: ICS_TENANT_ID, userId: ICS_USERS.carla };
  const ana = { tenantId: ICS_TENANT_ID, userId: ICS_USERS.ana };
  const created = server.createGroup(carla, { clientId: 'retorno', title: 'Equipe', memberIds: [ICS_USERS.carla, ICS_USERS.ana], ilhaId: null });
  if (!created.result.ok) throw created.result.error;
  const id = created.result.value.id;
  server.send(carla, { conversationId: id, clientId: 'presente', payload: { type: 'text', text: 'durante participação' } });
  expect(server.updateGroup(carla, { conversationId: id, remove: [ICS_USERS.ana] }).result.ok).toBe(true);
  server.send(carla, { conversationId: id, clientId: 'ausente', payload: { type: 'text', text: 'durante ausência' } });
  expect(server.updateGroup(carla, { conversationId: id, add: [ICS_USERS.ana] }).result.ok).toBe(true);
  const bootstrap = server.connect(ana);
  if (!bootstrap.result.ok) throw bootstrap.result.error;
  expect(bootstrap.result.value.recent[id]).toContainEqual(expect.objectContaining({ text: 'durante participação' }));
  expect(bootstrap.result.value.recent[id]).not.toContainEqual(expect.objectContaining({ text: 'durante ausência' }));
});

it('inicializa grupos das ilhas e Plantão Geral na seed', () => {
  const state = createSeedState('2026-11-13T12:00:00.000Z');
  const tenant = state.get(ICS_TENANT_ID);
  if (!tenant) throw new Error('tenant ausente');
  const groups = Object.values(tenant.conversations).filter((c) => c.kind === 'group');
  expect(groups.filter((g) => g.origin.kind === 'ilha')).toHaveLength(Object.keys(tenant.directory.ilhas).length);
  expect(groups).toContainEqual(expect.objectContaining({ title: 'Plantão Geral', origin: { kind: 'custom', createdBy: ICS_USERS.carla }, members: [ICS_USERS.carla, ICS_USERS.ana, ICS_USERS.bruno, ICS_USERS.rafael] }));
});

it('sair de grupo custom torna o histórico somente leitura e não permite sair do grupo de ilha', () => {
  const server = new MockServer(createSeedState('2026-11-13T12:00:00.000Z'));
  const ana = { tenantId: ICS_TENANT_ID, userId: ICS_USERS.ana };
  const tenant = server.getState().get(ICS_TENANT_ID);
  const groups = Object.values(tenant?.conversations ?? {}).filter((c): c is GroupConversation => c.kind === 'group' && c.members.includes(ICS_USERS.ana));
  const custom = groups.find((g) => g.origin.kind === 'custom');
  const ilha = groups.find((g) => g.origin.kind === 'ilha');
  if (!custom || !ilha) throw new Error('grupos ausentes');
  expect(server.leaveGroup(ana, { conversationId: ilha.id }).result.ok).toBe(false);
  expect(server.leaveGroup(ana, { conversationId: custom.id }).result.ok).toBe(true);
  const bootstrap = server.connect(ana);
  if (!bootstrap.result.ok) throw bootstrap.result.error;
  expect(bootstrap.result.value.conversations).toContainEqual(expect.objectContaining({ id: custom.id, readOnly: true }));
});

it('quem entra depois não recebe mensagens anteriores à entrada', () => {
  const server = new MockServer(createSeedState('2026-11-13T12:00:00.000Z'));
  const carla = { tenantId: ICS_TENANT_ID, userId: ICS_USERS.carla };
  const camila = { tenantId: ICS_TENANT_ID, userId: ICS_USERS.camila };
  const created = server.createGroup(carla, { clientId: 'historico', title: 'Equipe', memberIds: [ICS_USERS.carla, ICS_USERS.ana], ilhaId: null });
  if (!created.result.ok) throw created.result.error;
  const id = created.result.value.id;
  server.send(carla, { conversationId: id, clientId: 'antes', payload: { type: 'text', text: 'anterior à entrada' } });
  expect(server.updateGroup(carla, { conversationId: id, add: [ICS_USERS.camila] }).result.ok).toBe(true);
  const bootstrap = server.connect(camila);
  if (!bootstrap.result.ok) throw bootstrap.result.error;
  expect(bootstrap.result.value.recent[id]).not.toContainEqual(expect.objectContaining({ text: 'anterior à entrada' }));
});
