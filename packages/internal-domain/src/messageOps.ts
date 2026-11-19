import type { ConversationId } from './conversation';
import type { IsoInstant, MessageId } from './ids';
import type { UserId } from './identity';
import type { ChatMessage, DeletedMessage, ImageMessage, TextMessage, VideoMessage } from './message';
import { err, ok, type Result } from './result';

export const EDIT_WINDOW_MS = 15 * 60_000;
export const DELETE_FOR_ALL_WINDOW_MS = 48 * 60 * 60_000;
export const MAX_PINNED_MESSAGES = 3;
export const MAX_PINNED_CONVERSATIONS = 3;
export const MAX_FORWARD_TARGETS = 5;
export const MAX_FORWARD_SOURCES = 10;

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
