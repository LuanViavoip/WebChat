import { describe, expect, it } from 'vitest';
import { asConversationId } from './conversation';
import { asAnnouncementId, asClientId, asIsoInstant, asMessageId, asPollOptionId } from './ids';
import type { ChatMessage, ImageMessage, SystemMessage, TextMessage } from './message';
import {
  canDeleteForEveryone,
  canEdit,
  DELETE_FOR_ALL_WINDOW_MS,
  EDIT_WINDOW_MS,
  tombstone,
} from './messageOps';
import { err, ok } from './result';
import { T1, uid } from './testing/domainFixtures';

const ACTOR = uid('ag-1');
const OTHER = uid('ag-2');
const BASE_TIME = '2026-11-19T12:00:00.000Z';

function isoAfter(ms: number): ReturnType<typeof asIsoInstant> {
  return asIsoInstant(new Date(Date.parse(BASE_TIME) + ms).toISOString());
}

const base = {
  id: asMessageId('m-1'),
  tenantId: T1,
  conversationId: asConversationId('dm:empresa-1:ag-1:ag-2'),
  clientId: asClientId('c-1'),
  authorId: ACTOR,
  author: { id: ACTOR, name: 'Agente 1' },
  timestamp: BASE_TIME,
  status: 'sent' as const,
};

const textMsg: TextMessage = {
  ...base,
  type: 'text',
  text: 'Segredo original',
  mentions: [OTHER],
  replyTo: {
    messageId: asMessageId('m-0'),
    authorId: OTHER,
    quoted: { state: 'available', kind: 'text', excerpt: 'Anterior' },
  },
  forwarded: { times: 2 },
  editedAt: isoAfter(1000),
};

const imageMsg: ImageMessage = {
  ...base,
  type: 'image',
  mimeType: 'image/png',
  url: 'blob:foto',
  caption: 'Foto privada',
};

const systemMsg: SystemMessage = {
  id: asMessageId('sys-1'),
  tenantId: T1,
  conversationId: base.conversationId,
  actorId: ACTOR,
  timestamp: BASE_TIME,
  status: 'sent',
  type: 'system',
  action: 'created',
  text: 'Grupo criado',
};

describe('canEdit', () => {
  it.each<[string, ChatMessage, ReturnType<typeof uid>, ReturnType<typeof asIsoInstant>, ReturnType<typeof canEdit>]>([
    ['texto do autor dentro de 15 min', textMsg, ACTOR, isoAfter(EDIT_WINDOW_MS), ok(true)],
    ['imagem do autor dentro de 15 min', imageMsg, ACTOR, isoAfter(60_000), ok(true)],
    [
      'vídeo do autor dentro de 15 min',
      { ...base, type: 'video', mimeType: 'video/mp4', url: 'blob:v', caption: 'V' },
      ACTOR,
      isoAfter(60_000),
      ok(true),
    ],
    ['outro usuário não edita', textMsg, OTHER, isoAfter(1000), err('not-author')],
    ['texto após 15 min expira', textMsg, ACTOR, isoAfter(EDIT_WINDOW_MS + 1), err('window-expired')],
    ['sistema não é editável', systemMsg, ACTOR, isoAfter(1000), err('not-editable-kind')],
    [
      'áudio não é editável',
      { ...base, type: 'audio', mimeType: 'audio/ogg', url: 'blob:a' },
      ACTOR,
      isoAfter(1000),
      err('not-editable-kind'),
    ],
    [
      'enquete não é editável',
      {
        ...base,
        type: 'poll',
        question: 'Q?',
        options: [
          { id: asPollOptionId('1'), text: 'A' },
          { id: asPollOptionId('2'), text: 'B' },
        ],
        multiple: false,
        closedAt: null,
      },
      ACTOR,
      isoAfter(1000),
      err('not-editable-kind'),
    ],
    [
      'aviso encaminhado não é editável',
      { ...base, type: 'announcement', announcementId: asAnnouncementId('a1') },
      ACTOR,
      isoAfter(1000),
      err('not-editable-kind'),
    ],
    [
      'apagada não é editável',
      { ...base, type: 'deleted', deletedAt: isoAfter(500) },
      ACTOR,
      isoAfter(1000),
      err('not-editable-kind'),
    ],
  ])('%s', (_label, message, actor, now, expected) => {
    expect(canEdit(message, actor, now)).toEqual(expected);
  });
});

describe('canDeleteForEveryone', () => {
  it.each<[string, ChatMessage, ReturnType<typeof uid>, ReturnType<typeof asIsoInstant>, ReturnType<typeof canDeleteForEveryone>]>([
    ['autor dentro de 48h', textMsg, ACTOR, isoAfter(DELETE_FOR_ALL_WINDOW_MS), ok(true)],
    ['outro usuário não apaga', textMsg, OTHER, isoAfter(1000), err('not-author')],
    ['após 48h expira', textMsg, ACTOR, isoAfter(DELETE_FOR_ALL_WINDOW_MS + 1), err('window-expired')],
    ['já apagada', { ...base, type: 'deleted', deletedAt: isoAfter(500) }, ACTOR, isoAfter(1000), err('already-deleted')],
    ['mensagem de sistema', systemMsg, ACTOR, isoAfter(1000), err('not-deletable-kind')],
  ])('%s', (_label, message, actor, now, expected) => {
    expect(canDeleteForEveryone(message, actor, now)).toEqual(expected);
  });
});

describe('tombstone', () => {
  it('remove todo conteúdo sensível da mensagem original', () => {
    const deletedAt = isoAfter(5000);
    const removed = tombstone(textMsg, deletedAt);
    expect(removed).toEqual({
      id: textMsg.id,
      tenantId: textMsg.tenantId,
      conversationId: textMsg.conversationId,
      clientId: textMsg.clientId,
      authorId: textMsg.authorId,
      author: textMsg.author,
      timestamp: textMsg.timestamp,
      status: textMsg.status,
      forwarded: textMsg.forwarded,
      type: 'deleted',
      deletedAt,
    });
    expect(JSON.stringify(removed)).not.toContain('Segredo original');
    expect('text' in removed).toBe(false);
    expect('replyTo' in removed).toBe(false);
    expect('mentions' in removed).toBe(false);
    expect('editedAt' in removed).toBe(false);
  });

  it('remove url e caption de mídia apagada', () => {
    const removed = tombstone(imageMsg, isoAfter(5000));
    expect(JSON.stringify(removed)).not.toContain('blob:foto');
    expect(JSON.stringify(removed)).not.toContain('Foto privada');
  });
});
