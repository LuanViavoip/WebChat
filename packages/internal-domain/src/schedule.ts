import type { ConversationId } from './conversation';
import type { ClientId, IsoInstant, MessageId, ScheduledId } from './ids';
import type { UserId } from './identity';
import type { MessageRef } from './messageOps';
import { err, ok, type Result } from './result';
import type { TenantId } from './tenant';

export type ScheduleState =
  | { readonly phase: 'pending' }
  | { readonly phase: 'done'; readonly at: IsoInstant; readonly messageId?: MessageId }
  | { readonly phase: 'canceled'; readonly at: IsoInstant }
  | { readonly phase: 'failed'; readonly at: IsoInstant; readonly reason: 'forbidden' | 'conversation-gone' };

type ScheduledBase = {
  readonly id: ScheduledId;
  readonly tenantId: TenantId;
  readonly authorId: UserId;
  readonly state: ScheduleState;
};

export type ScheduledItem =
  | (ScheduledBase & {
      readonly kind: 'message';
      readonly conversationId: ConversationId;
      readonly text: string;
      readonly sendAt: IsoInstant;
    })
  | (ScheduledBase & {
      readonly kind: 'reminder';
      readonly note: string;
      readonly at: IsoInstant;
      readonly ref: MessageRef | null;
    });

export type ScheduleRequest =
  | {
      readonly kind: 'message';
      readonly clientId: ClientId;
      readonly conversationId: ConversationId;
      readonly text: string;
      readonly sendAt: IsoInstant;
    }
  | {
      readonly kind: 'reminder';
      readonly clientId: ClientId;
      readonly note: string;
      readonly at: IsoInstant;
      readonly ref?: MessageRef;
    };

export const MAX_SCHEDULE_AHEAD_MS = 30 * 24 * 60 * 60_000;
export const MAX_SCHEDULE_TEXT_LENGTH = 4000;

export type ScheduleValidationError = 'in-past' | 'too-far' | 'empty' | 'too-long';

export function validateSchedule(r: ScheduleRequest, now: IsoInstant): Result<true, ScheduleValidationError> {
  const rawText = r.kind === 'message' ? r.text : r.note;
  const trimmed = rawText.trim();
  if (!trimmed) {
    return err('empty');
  }
  if (trimmed.length > MAX_SCHEDULE_TEXT_LENGTH) {
    return err('too-long');
  }
  const targetIso = r.kind === 'message' ? r.sendAt : r.at;
  const targetMs = Date.parse(targetIso);
  const nowMs = Date.parse(now);
  if (Number.isNaN(targetMs) || Number.isNaN(nowMs) || targetMs <= nowMs) {
    return err('in-past');
  }
  if (targetMs - nowMs > MAX_SCHEDULE_AHEAD_MS) {
    return err('too-far');
  }
  return ok(true);
}
