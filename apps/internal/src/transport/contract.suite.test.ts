import {
  asAnnouncementId,
  asClientId,
  asIsoInstant,
  asMessageId,
  asQuickReplyId,
  asRevisionNo,
  asScheduledId,
  parseEmoji,
} from '@viavoip/internal-domain';
import { FakeBus } from '../test/fakeBroadcastChannel';
import { createFakeObjectUrls } from '../test/fakeObjectUrls';
import type { ChatEvent } from './ChatTransport';
import { defineChatTransportContract } from './contract.suite';
import { isNotImplemented, NotImplementedError } from './errors';
import { MockBackend } from './mock/MockBackend';
import { MemoryMockStore } from './mock/MockStore';
import { MockTransport } from './mock/MockTransport';
import { DEFAULT_SESSION, ICS_USERS, LIVE_CONVERSATION_ID } from './mock/seed';
import { createTabSync } from './mock/TabSync';

defineChatTransportContract('MockTransport', () => {
  const store = new MemoryMockStore();
  const bus = new FakeBus();
  const backends: MockBackend[] = [];
  const transports: MockTransport[] = [];
  const fixedNow = '2026-11-19T12:00:00.000Z';

  return {
    createTransport: () => {
      const backend = new MockBackend({
        store,
        tabSync: createTabSync(bus.factory),
        now: () => fixedNow,
      });
      backends.push(backend);
      const transport = new MockTransport({
        backend,
        delays: { connectMs: 0, sentMs: 0, deliveredMs: 0, readMs: 0, uploadChunkMs: 0 },
        objectUrls: createFakeObjectUrls(),
      });
      transports.push(transport);
      return transport;
    },
    cleanup: () => {
      for (const transport of transports) {
        transport.disconnect();
      }
      for (const backend of backends) {
        backend.close();
      }
    },
  };
});

describe('MockTransport: operações v1 pendentes rejeitam com NotImplementedError sem emitir eventos', () => {
  const like = parseEmoji('👍');
  if (!like) {
    throw new Error('Emoji inválido');
  }
  const messageId = asMessageId('msg:ics:1');
  const clientId = asClientId('cid-1');
  const announcementId = asAnnouncementId('ann-1');
  const revision = asRevisionNo(1);
  const now = asIsoInstant('2026-11-19T13:00:00.000Z');
  const ref = { conversationId: LIVE_CONVERSATION_ID, messageId };

  const cases: Array<readonly [string, (t: MockTransport) => Promise<unknown>]> = [
    [
      'upload (announcement-draft)',
      (t) =>
        t.upload({
          target: { kind: 'announcement-draft' },
          clientId: 'up-ann-1',
          file: new Blob(['a'], { type: 'image/png' }),
          fileName: 'aviso.png',
          mimeType: 'image/png',
          signal: new AbortController().signal,
          onProgress: () => undefined,
        }),
    ],
    ['history', (t) => t.history({ conversationId: LIVE_CONVERSATION_ID, limit: 20 })],
    ['react', (t) => t.react({ ...ref, emoji: like })],
    ['editMessage', (t) => t.editMessage({ ...ref, text: 'editado' })],
    ['deleteMessage', (t) => t.deleteMessage({ ...ref, scope: 'everyone' })],
    ['forward', (t) => t.forward({ sources: [ref], targets: [LIVE_CONVERSATION_ID], clientId })],
    ['setStar', (t) => t.setStar({ ...ref, starred: true })],
    ['pinMessage', (t) => t.pinMessage({ ...ref, pinned: true })],
    ['messageInfo', (t) => t.messageInfo(ref)],
    ['searchMessages', (t) => t.searchMessages({ query: 'oi', limit: 10 })],
    ['setPresence', (t) => t.setPresence({ status: 'pause', reason: 'lanche' })],
    ['setConversationPrefs', (t) => t.setConversationPrefs({ conversationId: LIVE_CONVERSATION_ID, pinned: true })],
    ['votePoll', (t) => t.votePoll({ ...ref, optionIds: [] })],
    ['closePoll', (t) => t.closePoll(ref)],
    [
      'schedule',
      (t) =>
        t.schedule({
          kind: 'message',
          clientId,
          conversationId: LIVE_CONVERSATION_ID,
          text: 'agendada',
          sendAt: now,
        }),
    ],
    ['cancelScheduled', (t) => t.cancelScheduled({ id: asScheduledId('sched-1') })],
    [
      'saveQuickReply',
      (t) =>
        t.saveQuickReply({
          shortcut: '/oi',
          text: 'Olá!',
          scope: { kind: 'personal', ownerId: ICS_USERS.carla },
        }),
    ],
    ['deleteQuickReply', (t) => t.deleteQuickReply({ id: asQuickReplyId('qr-1') })],
    [
      'publishAnnouncement',
      (t) =>
        t.publishAnnouncement({
          clientId,
          content: { title: 'Aviso', body: 'Texto', media: { kind: 'none' } },
          audience: { kind: 'all' },
          expiresAt: null,
          pinned: false,
          delivery: { kind: 'board' },
          requiresAck: true,
        }),
    ],
    [
      'editAnnouncement',
      (t) =>
        t.editAnnouncement({
          id: announcementId,
          edit: { kind: 'pin', pinned: true },
        }),
    ],
    ['markAnnouncementViewed', (t) => t.markAnnouncementViewed({ id: announcementId, revision })],
    [
      'reportPlayback',
      (t) => t.reportPlayback({ id: announcementId, revision, maxPositionMs: 1000, durationMs: 2000, ended: false }),
    ],
    ['acknowledgeAnnouncement', (t) => t.acknowledgeAnnouncement({ id: announcementId, revision })],
    ['announcementReceipts', (t) => t.announcementReceipts({ id: announcementId })],
    ['remindAnnouncement', (t) => t.remindAnnouncement({ id: announcementId })],
    [
      'forwardAnnouncement',
      (t) => t.forwardAnnouncement({ announcementId, targets: [LIVE_CONVERSATION_ID], clientId }),
    ],
  ];

  it.each(cases)('%s rejeita com NotImplementedError sem emitir evento', async (_label, invoke) => {
    const transport = new MockTransport({ delays: { connectMs: 0 } });
    await transport.connect(DEFAULT_SESSION);
    const events: ChatEvent[] = [];
    transport.subscribe((event) => {
      events.push(event);
    });

    const outcome = await invoke(transport).then(
      () => undefined,
      (error: unknown) => error,
    );
    expect(outcome).toBeInstanceOf(NotImplementedError);
    expect(isNotImplemented(outcome)).toBe(true);
    expect(events).toEqual([]);
    transport.disconnect();
  });
});
