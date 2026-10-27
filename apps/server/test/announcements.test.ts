import { announcementAckSchema, announcementListAckSchema, announcementSchema } from '@viavoip/protocol';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { demoAccounts, demoIds, demoPassword } from '../src/demo/ids.js';
import { connectSocket, emitAck, login, startTestApp, waitConnect, waitEvent, type TestApp } from './helpers.js';

let app: TestApp;

beforeAll(async () => {
  app = await startTestApp();
});

afterAll(async () => {
  await app.app.close();
});

describe('quadro de anúncios', () => {
  it('publica para o setor certo, registra leitura e esconde o restante', async () => {
    const sofiaLogin = await login(app.baseUrl, demoAccounts.sofia, demoPassword);
    const anaLogin = await login(app.baseUrl, demoAccounts.ana, demoPassword);
    const helenaLogin = await login(app.baseUrl, demoAccounts.helena, demoPassword);
    const dianaLogin = await login(app.baseUrl, demoAccounts.diana, demoPassword);
    const sofia = connectSocket(app.baseUrl, '/supervisor', sofiaLogin.token);
    const ana = connectSocket(app.baseUrl, '/agent', anaLogin.token);
    const helena = connectSocket(app.baseUrl, '/supervisor', helenaLogin.token);
    const diana = connectSocket(app.baseUrl, '/agent', dianaLogin.token);
    await Promise.all([waitConnect(sofia), waitConnect(ana), waitConnect(helena), waitConnect(diana)]);
    const company = announcementListAckSchema.parse(await emitAck(helena, 'announcement.publish', {
      title: 'Empresa inteira',
      body: 'Somente o administrador publica para todos.',
      audience: 'tenant',
    }));
    expect(company.ok).toBe(false);
    if (!company.ok) expect(company.error.code).toBe('forbidden');
    const incoming = waitEvent(ana, 'announcement.published');
    const title = `Escala ${randomUUID().slice(0, 8)}`;
    const published = announcementAckSchema.parse(
      await emitAck(sofia, 'announcement.publish', {
        title,
        body: 'Vale só para o suporte.',
        audience: 'sectors',
        sectorIds: [demoIds.sectorSupportA],
      }),
    );
    expect(published.ok).toBe(true);
    if (!published.ok) return;
    expect(published.announcement.unread).toBe(true);
    const event = announcementSchema.parse(await incoming);
    expect(event.id).toBe(published.announcement.id);
    const anaList = announcementListAckSchema.parse(await emitAck(ana, 'announcement.list', {}));
    const dianaList = announcementListAckSchema.parse(await emitAck(diana, 'announcement.list', {}));
    expect(anaList.ok && dianaList.ok).toBe(true);
    if (!anaList.ok || !dianaList.ok) return;
    expect(anaList.announcements.map((item) => item.id)).toContain(published.announcement.id);
    expect(anaList.announcements.map((item) => item.id)).toContain(demoIds.announcementCompanyA);
    expect(dianaList.announcements.map((item) => item.id)).not.toContain(published.announcement.id);
    expect(dianaList.announcements.map((item) => item.id)).toContain(demoIds.announcementCompanyA);
    const read = announcementAckSchema.parse(
      await emitAck(ana, 'announcement.read', { announcementId: published.announcement.id }),
    );
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.announcement.unread).toBe(false);
    const hidden = announcementAckSchema.parse(
      await emitAck(diana, 'announcement.read', { announcementId: published.announcement.id }),
    );
    expect(hidden.ok).toBe(false);
    if (!hidden.ok) expect(hidden.error.code).toBe('not_found');
    sofia.disconnect();
    ana.disconnect();
    helena.disconnect();
    diana.disconnect();
  });
});
