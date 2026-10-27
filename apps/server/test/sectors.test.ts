import { sectorListAckSchema, sectorSaveAckSchema } from '@viavoip/protocol';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { demoAccounts, demoIds, demoPassword } from '../src/demo/ids.js';
import { connectSocket, emitAck, login, startTestApp, waitConnect, type TestApp } from './helpers.js';

let app: TestApp;

beforeAll(async () => {
  app = await startTestApp();
});

afterAll(async () => {
  await app.app.close();
});

describe('setores', () => {
  it('cria, edita, inclui e remove membros dentro do escopo', async () => {
    const sofia = await login(app.baseUrl, demoAccounts.sofia, demoPassword);
    const socket = connectSocket(app.baseUrl, '/supervisor', sofia.token);
    await waitConnect(socket);
    const created = sectorSaveAckSchema.parse(
      await emitAck(socket, 'sector.save', { name: `Plantão ${randomUUID().slice(0, 8)}`, description: 'Noite' }),
    );
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const renamed = sectorSaveAckSchema.parse(
      await emitAck(socket, 'sector.save', {
        sectorId: created.sector.id,
        name: created.sector.name,
        description: 'Madrugada',
      }),
    );
    expect(renamed.ok).toBe(true);
    if (!renamed.ok) return;
    expect(renamed.sector.description).toBe('Madrugada');
    const added = sectorSaveAckSchema.parse(
      await emitAck(socket, 'sector.member.add', { sectorId: created.sector.id, agentId: demoIds.agentEduardo }),
    );
    expect(added.ok).toBe(true);
    if (!added.ok) return;
    expect(added.sector.members.map((member) => member.agentId)).toContain(demoIds.agentEduardo);
    const removed = sectorSaveAckSchema.parse(
      await emitAck(socket, 'sector.member.remove', { sectorId: created.sector.id, agentId: demoIds.agentEduardo }),
    );
    expect(removed.ok).toBe(true);
    if (!removed.ok) return;
    expect(removed.sector.members.map((member) => member.agentId)).not.toContain(demoIds.agentEduardo);
    socket.disconnect();
  });

  it('mostra ao agente só os setores em que ele participa', async () => {
    const ana = await login(app.baseUrl, demoAccounts.ana, demoPassword);
    const socket = connectSocket(app.baseUrl, '/agent', ana.token);
    await waitConnect(socket);
    const listed = sectorListAckSchema.parse(await emitAck(socket, 'sector.list', {}));
    expect(listed.ok).toBe(true);
    if (!listed.ok) return;
    const ids = listed.sectors.map((sector) => sector.id);
    expect(ids).toContain(demoIds.sectorSupportA);
    expect(ids).toContain(demoIds.sectorCommercialA);
    expect(ids).not.toContain(demoIds.sectorSupportB);
    expect(listed.sectors.every((sector) => sector.canManage === false)).toBe(true);
    const denied = sectorSaveAckSchema.parse(await emitAck(socket, 'sector.save', { name: 'Invasão' }));
    expect(denied.ok).toBe(false);
    if (!denied.ok) expect(denied.error.code).toBe('forbidden');
    socket.disconnect();
  });

  it('impede o supervisor de outro setor e o outro tenant', async () => {
    const helena = await login(app.baseUrl, demoAccounts.helena, demoPassword);
    const helenaSocket = connectSocket(app.baseUrl, '/supervisor', helena.token);
    await waitConnect(helenaSocket);
    const denied = sectorSaveAckSchema.parse(
      await emitAck(helenaSocket, 'sector.member.add', {
        sectorId: demoIds.sectorSupportA,
        agentId: demoIds.agentDiana,
      }),
    );
    expect(denied.ok).toBe(false);
    if (!denied.ok) expect(denied.error.code).toBe('forbidden');
    const own = sectorListAckSchema.parse(await emitAck(helenaSocket, 'sector.list', {}));
    expect(own.ok).toBe(true);
    if (own.ok) {
      expect(own.sectors.map((sector) => sector.id)).toContain(demoIds.sectorCommercialA);
      expect(own.sectors.map((sector) => sector.id)).not.toContain(demoIds.sectorSupportA);
    }
    helenaSocket.disconnect();

    const renata = await login(app.baseUrl, demoAccounts.renata, demoPassword);
    const renataSocket = connectSocket(app.baseUrl, '/supervisor', renata.token);
    await waitConnect(renataSocket);
    const foreign = sectorListAckSchema.parse(await emitAck(renataSocket, 'sector.list', {}));
    expect(foreign.ok).toBe(true);
    if (foreign.ok) {
      const ids = foreign.sectors.map((sector) => sector.id);
      expect(ids).toContain(demoIds.sectorSupportB);
      expect(ids).not.toContain(demoIds.sectorSupportA);
    }
    renataSocket.disconnect();
  });
});
