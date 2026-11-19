import { describe, expect, it } from 'vitest';
import { CAPTION_MAX_LENGTH } from './attachment';
import { asConversationId, type Conversation, type DirectPair, type GroupConversation } from './conversation';
import { asAnnouncementId, asClientId, asIsoInstant, asMessageId, asPollOptionId } from './ids';
import type { ChatMessage, ImageMessage, SystemMessage, TextMessage, VideoMessage } from './message';
import {
  applyEdit,
  canDeleteForEveryone,
  canEdit,
  canForwardMessage,
  DELETE_FOR_ALL_WINDOW_MS,
  EDIT_WINDOW_MS,
  MAX_FORWARD_SOURCES,
  TEXT_MAX_LENGTH,
  tombstone,
  validMentions,
} from './messageOps';
import { err, ok } from './result';
import { seedDirectory, T1, T2, uid, user } from './testing/domainFixtures';

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
  timestamp: asIsoInstant(BASE_TIME),
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
  timestamp: asIsoInstant(BASE_TIME),
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

const videoMsg: VideoMessage = {
  ...base,
  type: 'video',
  mimeType: 'video/mp4',
  url: 'blob:v',
  caption: 'Vídeo original',
};

describe('applyEdit', () => {
  const at = isoAfter(1000);

  it.each<[string, EditableInput, string, ReturnType<typeof applyEdit>]>([
    ['atualiza texto e marca editedAt', textMsg, 'Segredo novo', ok({ ...textMsg, text: 'Segredo novo', editedAt: at })],
    ['recusa texto vazio', textMsg, '   ', err('empty')],
    ['recusa texto sem mudança', textMsg, 'Segredo original', err('no-change')],
    [
      'recusa texto longo demais',
      textMsg,
      'x'.repeat(TEXT_MAX_LENGTH + 1),
      err('too-long'),
    ],
    [
      'atualiza legenda de imagem',
      imageMsg,
      'Nova foto',
      ok({ ...imageMsg, caption: 'Nova foto', editedAt: at }),
    ],
    ['remove legenda de vídeo quando o texto fica vazio', videoMsg, '  ', ok({
      id: videoMsg.id,
      tenantId: videoMsg.tenantId,
      conversationId: videoMsg.conversationId,
      clientId: videoMsg.clientId,
      authorId: videoMsg.authorId,
      author: videoMsg.author,
      timestamp: videoMsg.timestamp,
      status: videoMsg.status,
      type: 'video',
      mimeType: videoMsg.mimeType,
      url: videoMsg.url,
      editedAt: at,
    })],
    [
      'recusa legenda longa demais',
      imageMsg,
      'y'.repeat(CAPTION_MAX_LENGTH + 1),
      err('too-long'),
    ],
  ])('%s', (_label, message, text, expected) => {
    expect(applyEdit(message, text, at)).toEqual(expected);
  });
});

type EditableInput = TextMessage | ImageMessage | VideoMessage;

function directBetween(a: string, b: string, tenantId = T1): Conversation {
  const first = uid(a);
  const second = uid(b);
  const [low, high] = first < second ? [first, second] : [second, first];
  return {
    kind: 'direct',
    id: asConversationId(`dm:${tenantId}:${low}:${high}`),
    tenantId,
    participants: [low, high] as unknown as DirectPair,
  };
}

function customGroup(memberIds: readonly string[], extras: Partial<GroupConversation> = {}): GroupConversation {
  const members = memberIds.map(uid) as [ReturnType<typeof uid>, ...ReturnType<typeof uid>[]];
  return {
    kind: 'group',
    id: asConversationId(`grp:${T1}:fwd`),
    tenantId: T1,
    title: 'Grupo',
    origin: { kind: 'custom', createdBy: members[0] },
    members,
    formerMemberIds: [],
    createdAt: BASE_TIME,
    ...extras,
  };
}

describe('canForwardMessage', () => {
  const d = seedDirectory();
  const actor = user(d, 'ag-1');
  const from = directBetween('ag-1', 'ag-2');
  const to = directBetween('ag-1', 'ag-3');

  it.each<[string, ChatMessage, Conversation, Conversation, ReturnType<typeof canForwardMessage>]>([
    ['encaminha texto entre conversas da mesma empresa', textMsg, from, to, ok(true)],
    ['recusa cross-tenant', textMsg, from, { ...to, tenantId: T2 }, err('cross-tenant')],
    ['recusa apagada', { ...base, type: 'deleted', deletedAt: isoAfter(1) }, from, to, err('not-forwardable-kind')],
    ['recusa sistema', systemMsg, from, to, err('not-forwardable-kind')],
    [
      'recusa enquete',
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
      from,
      to,
      err('not-forwardable-kind'),
    ],
    [
      'recusa aviso (regra própria)',
      { ...base, type: 'announcement', announcementId: asAnnouncementId('a1') },
      from,
      to,
      err('not-forwardable-kind'),
    ],
    ['recusa origem em que o ator não participa', textMsg, directBetween('ag-2', 'ag-3'), to, err('not-participant-source')],
    ['recusa destino em que o ator não participa', textMsg, from, directBetween('ag-2', 'ag-3'), err('not-participant-target')],
    [
      'recusa destino somente leitura (ex-membro)',
      textMsg,
      from,
      customGroup(['ag-2', 'ag-3'], { formerMemberIds: [actor.id] }),
      err('read-only-target'),
    ],
    [
      'recusa cadeia longa demais',
      { ...textMsg, forwarded: { times: MAX_FORWARD_SOURCES } },
      from,
      to,
      err('too-many'),
    ],
  ])('%s', (_label, message, source, target, expected) => {
    expect(canForwardMessage(message, source, target, actor)).toEqual(expected);
  });
});

describe('validMentions', () => {
  const d = seedDirectory();
  const conversation = customGroup(['ag-1', 'ag-2']);

  it('mantém só participantes ativos, na ordem, sem duplicar', () => {
    expect(validMentions([uid('ag-2'), uid('ag-3'), uid('ag-2'), uid('ag-1')], conversation, d)).toEqual([
      uid('ag-2'),
      uid('ag-1'),
    ]);
  });

  it('ignora menções de outro tenant ou conversa alheia', () => {
    expect(validMentions([uid('ag-1')], { ...conversation, tenantId: T2 }, d)).toEqual([]);
  });
});
