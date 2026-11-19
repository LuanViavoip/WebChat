import { CAPTION_MAX_LENGTH } from './attachment';
import type { Conversation, ConversationId } from './conversation';
import type { IsoInstant, MessageId } from './ids';
import type { Directory, StaffUser, UserId } from './identity';
import type { ChatMessage, DeletedMessage, ImageMessage, TextMessage, VideoMessage } from './message';
import { own } from './records';
import { err, ok, type Result } from './result';

export const EDIT_WINDOW_MS = 15 * 60_000;
export const DELETE_FOR_ALL_WINDOW_MS = 48 * 60 * 60_000;
export const MAX_PINNED_MESSAGES = 3;
export const MAX_PINNED_CONVERSATIONS = 3;
export const MAX_FORWARD_TARGETS = 5;
export const MAX_FORWARD_SOURCES = 10;
export const TEXT_MAX_LENGTH = 4000;

export type MessageRef = {
  readonly conversationId: ConversationId;
  readonly messageId: MessageId;
};

export type EditableMessage = TextMessage | ImageMessage | VideoMessage;

export type EditDenial = 'not-author' | 'not-editable-kind' | 'window-expired' | 'empty' | 'too-long' | 'no-change';

/** Só texto e legenda (image e video). Poll, deleted, system e announcement não se editam. */
export function canEdit(m: ChatMessage, actor: UserId, now: IsoInstant): Result<true, EditDenial> {
  if (m.type === 'system') {
    return err('not-editable-kind');
  }
  if (m.authorId !== actor) {
    return err('not-author');
  }
  if (m.type !== 'text' && m.type !== 'image' && m.type !== 'video') {
    return err('not-editable-kind');
  }
  const elapsed = Date.parse(now) - Date.parse(m.timestamp);
  if (Number.isNaN(elapsed) || elapsed > EDIT_WINDOW_MS) {
    return err('window-expired');
  }
  return ok(true);
}

export type DeleteScope = 'everyone' | 'me';
export type DeleteDenial = 'not-author' | 'window-expired' | 'already-deleted' | 'not-deletable-kind';

export function canDeleteForEveryone(m: ChatMessage, actor: UserId, now: IsoInstant): Result<true, DeleteDenial> {
  if (m.type === 'deleted') {
    return err('already-deleted');
  }
  if (m.type === 'system') {
    return err('not-deletable-kind');
  }
  if (m.authorId !== actor) {
    return err('not-author');
  }
  const elapsed = Date.parse(now) - Date.parse(m.timestamp);
  if (Number.isNaN(elapsed) || elapsed > DELETE_FOR_ALL_WINDOW_MS) {
    return err('window-expired');
  }
  return ok(true);
}

export function tombstone(m: ChatMessage, at: IsoInstant): DeletedMessage {
  if (m.type === 'system') {
    throw new Error('Mensagem de sistema não pode ser apagada para todos.');
  }
  return {
    id: m.id,
    tenantId: m.tenantId,
    conversationId: m.conversationId,
    ...(m.clientId !== undefined ? { clientId: m.clientId } : {}),
    authorId: m.authorId,
    author: m.author,
    timestamp: m.timestamp,
    status: m.status,
    ...(m.forwarded !== undefined ? { forwarded: m.forwarded } : {}),
    type: 'deleted',
    deletedAt: at,
  };
}

export type ForwardDenial =
  | 'not-participant-source'
  | 'not-participant-target'
  | 'cross-tenant'
  | 'not-forwardable-kind'
  | 'too-many'
  | 'read-only-target';

export function applyEdit(
  m: EditableMessage,
  text: string,
  at: IsoInstant,
): Result<ChatMessage, EditDenial> {
  const trimmed = text.trim();
  switch (m.type) {
    case 'text': {
      if (!trimmed) {
        return err('empty');
      }
      if (trimmed.length > TEXT_MAX_LENGTH) {
        return err('too-long');
      }
      if (trimmed === m.text) {
        return err('no-change');
      }
      return ok({ ...m, text: trimmed, editedAt: at });
    }
    case 'image':
    case 'video': {
      if (trimmed.length > CAPTION_MAX_LENGTH) {
        return err('too-long');
      }
      const current = m.caption ?? '';
      if (trimmed === current) {
        return err('no-change');
      }
      if (!trimmed) {
        const rest: EditableMessage = { ...m, editedAt: at };
        delete (rest as { caption?: string }).caption;
        return ok(rest);
      }
      return ok({ ...m, caption: trimmed, editedAt: at });
    }
    default: {
      const exhaustive: never = m;
      return exhaustive;
    }
  }
}

function participantsOf(conversation: Conversation): readonly UserId[] {
  return conversation.kind === 'direct' ? conversation.participants : conversation.members;
}

function isFormerMember(conversation: Conversation, userId: UserId): boolean {
  return conversation.kind === 'group' && conversation.formerMemberIds.includes(userId);
}

/** Mensagem comum: cópia com ForwardMark. Proibido: deleted, system e poll. 'announcement' tem regra própria (B.9.6). */
export function canForwardMessage(
  m: ChatMessage,
  from: Conversation,
  to: Conversation,
  actor: StaffUser,
): Result<true, ForwardDenial> {
  if (from.tenantId !== to.tenantId || actor.tenantId !== from.tenantId || m.tenantId !== from.tenantId) {
    return err('cross-tenant');
  }
  switch (m.type) {
    case 'deleted':
    case 'system':
    case 'poll':
    case 'announcement':
      return err('not-forwardable-kind');
    case 'text':
    case 'image':
    case 'audio':
    case 'video':
    case 'document':
    case 'sticker':
      break;
    default: {
      const exhaustive: never = m;
      return exhaustive;
    }
  }
  if (m.forwarded !== undefined && m.forwarded.times >= MAX_FORWARD_SOURCES) {
    return err('too-many');
  }
  if (!participantsOf(from).includes(actor.id)) {
    return err('not-participant-source');
  }
  if (isFormerMember(to, actor.id)) {
    return err('read-only-target');
  }
  if (!participantsOf(to).includes(actor.id)) {
    return err('not-participant-target');
  }
  return ok(true);
}

/** Recorta as menções válidas (só participantes ativos da conversa). A menção inválida vira texto comum. */
export function validMentions(
  ids: readonly UserId[],
  conversation: Conversation,
  d: Directory,
): readonly UserId[] {
  if (conversation.tenantId !== d.tenantId) {
    return [];
  }
  const allowed = new Set(
    participantsOf(conversation).filter((id) => {
      const user = own(d.users, id);
      return user !== undefined && user.active && user.tenantId === d.tenantId;
    }),
  );
  const seen = new Set<UserId>();
  const valid: UserId[] = [];
  for (const id of ids) {
    if (!allowed.has(id) || seen.has(id)) {
      continue;
    }
    seen.add(id);
    valid.push(id);
  }
  return valid;
}
