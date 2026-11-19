import { describe, expect, it } from 'vitest';
import {
  announcementPrompt,
  canForwardAnnouncementTo,
  type Announcement,
  type AnnouncementForReader,
  type PromptTrigger,
} from './announcement';
import type { ReceiptState } from './announcementReceipt';
import { asConversationId, directConversation, type GroupConversation } from './conversation';
import { asAnnouncementId, asIsoInstant, asRevisionNo } from './ids';
import type { PresenceStatus } from './presence';
import { err, ok } from './result';
import { seedDirectory, T1, T2, user } from './testing/domainFixtures';

const d = seedDirectory(T1);
const dB = seedDirectory(T2);
const sup1 = user(d, 'sup-1');
const ag1 = user(d, 'ag-1');
const ag2 = user(d, 'ag-2');
const ag3 = user(d, 'ag-3');
const agB = user(dB, 'ag-1-b');

const NOW = asIsoInstant('2026-11-19T12:00:00.000Z');
const PAST = asIsoInstant('2026-11-19T11:00:00.000Z');
const LATER = asIsoInstant('2026-11-19T11:30:00.000Z');
const FUTURE = asIsoInstant('2026-11-19T14:00:00.000Z');

const available: PresenceStatus = { kind: 'available' };
const pause: PresenceStatus = { kind: 'pause', reason: 'lanche', since: PAST };
const away: PresenceStatus = { kind: 'away', since: PAST };

function readerItem(
  id: string,
  options: {
    delivery?: AnnouncementForReader['delivery'];
    requiresAck?: boolean;
    publishedAt?: ReturnType<typeof asIsoInstant>;
    expiresAt?: ReturnType<typeof asIsoInstant> | null;
    receipt?: ReceiptState;
  } = {},
): { announcement: AnnouncementForReader; receipt: ReceiptState } {
  const publishedAt = options.publishedAt ?? PAST;
  const rev = asRevisionNo(1);
  return {
    announcement: {
      id: asAnnouncementId(id),
      tenantId: T1,
      authorId: sup1.id,
      delivery: options.delivery ?? { kind: 'board' },
      requiresAck: options.requiresAck ?? true,
      pinned: false,
      publishedAt,
      expiresAt: options.expiresAt ?? null,
      current: {
        no: rev,
        content: { title: `Aviso ${id}`, body: 'Texto', media: { kind: 'none' } },
        editedAt: publishedAt,
        editedBy: sup1.id,
        material: true,
      },
      ackRevision: rev,
      edited: false,
      ilhaIds: [],
    },
    receipt: options.receipt ?? { phase: 'unseen' },
  };
}

describe('announcementPrompt', () => {
  const boardUnseenOld = readerItem('b1', { publishedAt: PAST });
  const boardUnseenNew = readerItem('b2', { publishedAt: LATER });
  const boardViewedPendingAck = readerItem('b3', {
    receipt: { phase: 'viewed', viewedAt: PAST, maxPositionMs: 0 },
  });
  const boardAcked = readerItem('b4', {
    receipt: { phase: 'acknowledged', viewedAt: PAST, playedAt: null, acknowledgedAt: LATER },
  });
  const boardExpired = readerItem('b-exp', { expiresAt: PAST });
  const interruptOld = readerItem('i1', {
    delivery: { kind: 'interrupt', requireFullPlayback: false },
    publishedAt: PAST,
  });
  const interruptNew = readerItem('i2', {
    delivery: { kind: 'interrupt', requireFullPlayback: true },
    publishedAt: LATER,
  });
  const interruptAcked = readerItem('i3', {
    delivery: { kind: 'interrupt', requireFullPlayback: false },
    receipt: { phase: 'acknowledged', viewedAt: PAST, playedAt: null, acknowledgedAt: LATER },
  });

  it.each<
    [
      string,
      {
        entries: readonly { announcement: AnnouncementForReader; receipt: ReceiptState }[];
        presence: PresenceStatus;
        trigger: PromptTrigger;
        firstLoginOfDay: boolean;
        redirectedThisSession: boolean;
      },
      ReturnType<typeof announcementPrompt>,
    ]
  >([
    [
      'fila interrupt do mais antigo para o mais novo quando disponível',
      {
        entries: [interruptNew, boardUnseenNew, interruptOld, interruptAcked],
        presence: available,
        trigger: 'connect',
        firstLoginOfDay: true,
        redirectedThisSession: false,
      },
      { kind: 'interrupt', queue: [asAnnouncementId('i1'), asAnnouncementId('i2')] },
    ],
    [
      'em pausa não abre interrupt',
      {
        entries: [interruptOld],
        presence: pause,
        trigger: 'arrived',
        firstLoginOfDay: false,
        redirectedThisSession: false,
      },
      { kind: 'none' },
    ],
    [
      'em ausente não abre interrupt',
      {
        entries: [interruptOld],
        presence: away,
        trigger: 'connect',
        firstLoginOfDay: false,
        redirectedThisSession: false,
      },
      { kind: 'none' },
    ],
    [
      'abre interrupt ao voltar a ficar disponível',
      {
        entries: [interruptOld],
        presence: available,
        trigger: 'became-available',
        firstLoginOfDay: false,
        redirectedThisSession: true,
      },
      { kind: 'interrupt', queue: [asAnnouncementId('i1')] },
    ],
    [
      'primeiro login do dia com board pendente abre o quadro',
      {
        entries: [boardViewedPendingAck, boardUnseenNew, boardAcked],
        presence: available,
        trigger: 'connect',
        firstLoginOfDay: true,
        redirectedThisSession: false,
      },
      { kind: 'open-board', first: asAnnouncementId('b3'), count: 2 },
    ],
    [
      'após redirecionar na sessão, board unseen vira alerta de canto com o mais novo',
      {
        entries: [boardUnseenOld, boardUnseenNew, boardViewedPendingAck],
        presence: available,
        trigger: 'arrived',
        firstLoginOfDay: true,
        redirectedThisSession: true,
      },
      { kind: 'corner-alert', newest: asAnnouncementId('b2'), count: 2 },
    ],
    [
      'aviso board já visto mas pendente de ciência ao longo do dia não mostra alerta de canto',
      {
        entries: [boardViewedPendingAck, boardAcked],
        presence: available,
        trigger: 'connect',
        firstLoginOfDay: false,
        redirectedThisSession: false,
      },
      { kind: 'none' },
    ],
    [
      'avisos expirados são ignorados',
      {
        entries: [boardExpired, readerItem('i-exp', { delivery: { kind: 'interrupt', requireFullPlayback: false }, expiresAt: NOW })],
        presence: available,
        trigger: 'connect',
        firstLoginOfDay: true,
        redirectedThisSession: false,
      },
      { kind: 'none' },
    ],
  ])('%s', (_label, params, expected) => {
    expect(announcementPrompt({ ...params, now: NOW })).toEqual(expected);
  });
});

describe('canForwardAnnouncementTo', () => {
  const rev = asRevisionNo(1);
  const baseAnnouncement: Announcement = {
    id: asAnnouncementId('av-1'),
    tenantId: T1,
    authorId: sup1.id,
    audience: { kind: 'people', userIds: [ag1.id, ag2.id] },
    audienceUserIds: [ag1.id, ag2.id],
    delivery: { kind: 'board' },
    requiresAck: false,
    pinned: false,
    publishedAt: PAST,
    expiresAt: FUTURE,
    revisions: [
      {
        no: rev,
        content: { title: 'Comunicado', body: 'Corpo', media: { kind: 'none' } },
        editedAt: PAST,
        editedBy: sup1.id,
        material: true,
      },
    ],
  };

  const dmCovered = directConversation(ag1, ag2);
  const dmUncovered = directConversation(ag1, ag3);
  const dmCrossTenant = directConversation(agB, user(dB, 'sup-1-b'));
  if (!dmCovered.ok || !dmUncovered.ok || !dmCrossTenant.ok) {
    throw new Error('Falha ao criar diretas de teste');
  }

  const groupCovered: GroupConversation = {
    kind: 'group',
    id: asConversationId('grp-covered'),
    tenantId: T1,
    title: 'Coberto',
    origin: { kind: 'custom', createdBy: sup1.id },
    members: [sup1.id, ag1.id, ag2.id],
    formerMemberIds: [],
    createdAt: PAST,
  };

  const groupUncovered: GroupConversation = {
    ...groupCovered,
    id: asConversationId('grp-uncovered'),
    members: [sup1.id, ag1.id, ag3.id],
  };

  it.each([
    ['permite encaminhar para direta totalmente coberta pelo público', ag1, baseAnnouncement, dmCovered.value, NOW, ok(true)],
    ['permite encaminhar para grupo com autor e público', ag1, baseAnnouncement, groupCovered, NOW, ok(true)],
    ['recusa quando algum membro do destino não está no público', ag1, baseAnnouncement, dmUncovered.value, NOW, err('audience-not-covering')],
    ['recusa grupo quando um membro está fora do público', ag1, baseAnnouncement, groupUncovered, NOW, err('audience-not-covering')],
    ['recusa quando o ator não participa do destino', ag2, baseAnnouncement, groupUncovered, NOW, err('not-member')],
    ['recusa quando o ator não pode ler o aviso', ag3, baseAnnouncement, dmUncovered.value, NOW, err('not-readable')],
    ['recusa aviso expirado', ag1, { ...baseAnnouncement, expiresAt: PAST }, dmCovered.value, NOW, err('expired')],
    ['recusa conversa de outro tenant', ag1, baseAnnouncement, dmCrossTenant.value, NOW, err('cross-tenant')],
    ['recusa ator de outro tenant', agB, baseAnnouncement, dmCovered.value, NOW, err('cross-tenant')],
  ])('%s', (_label, actor, announcement, target, now, expected) => {
    expect(canForwardAnnouncementTo(actor, announcement, target, now)).toEqual(expected);
  });
});
