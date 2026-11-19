import type { ConversationId } from './conversation';
import type { MessageId, PollOptionId } from './ids';
import type { UserId } from './identity';
import type { PollMessage } from './message';
import { err, ok, type Result } from './result';

export type VotePollRequest = {
  readonly conversationId: ConversationId;
  readonly messageId: MessageId;
  /** Lista vazia retira o voto. */
  readonly optionIds: readonly PollOptionId[];
};

export type PollTally = {
  readonly totals: Readonly<Record<PollOptionId, number>>;
  readonly voters: Readonly<Record<PollOptionId, readonly UserId[]>>;
  readonly closed: boolean;
};

export type PollDenial = 'not-group' | 'closed' | 'multiple-not-allowed' | 'unknown-option' | 'not-member';

export type PollValidationError =
  | 'empty-question'
  | 'too-few-options'
  | 'too-many-options'
  | 'duplicate-option'
  | 'too-long';

export type ValidatedPoll = {
  readonly question: string;
  readonly options: readonly [string, string, ...string[]];
  readonly multiple: boolean;
};

export const MAX_POLL_QUESTION_LENGTH = 200;
export const MAX_POLL_OPTION_LENGTH = 80;
export const MIN_POLL_OPTIONS = 2;
export const MAX_POLL_OPTIONS = 12;

export function validatePoll(input: {
  readonly question: string;
  readonly options: readonly string[];
  readonly multiple: boolean;
}): Result<ValidatedPoll, PollValidationError> {
  const question = input.question.trim();
  if (!question) {
    return err('empty-question');
  }
  if (question.length > MAX_POLL_QUESTION_LENGTH) {
    return err('too-long');
  }
  const cleanOptions = input.options.map((option) => option.trim()).filter((option) => option.length > 0);
  const [first, second, ...rest] = cleanOptions;
  if (!first || !second) {
    return err('too-few-options');
  }
  if (cleanOptions.length > MAX_POLL_OPTIONS) {
    return err('too-many-options');
  }
  if (cleanOptions.some((option) => option.length > MAX_POLL_OPTION_LENGTH)) {
    return err('too-long');
  }
  const seen = new Set<string>();
  for (const option of cleanOptions) {
    const normalized = option.toLocaleLowerCase('pt-BR');
    if (seen.has(normalized)) {
      return err('duplicate-option');
    }
    seen.add(normalized);
  }
  return ok({
    question,
    options: [first, second, ...rest],
    multiple: input.multiple,
  });
}

export function applyVote(
  t: PollTally,
  userId: UserId,
  optionIds: readonly PollOptionId[],
  poll: PollMessage,
): Result<PollTally, PollDenial> {
  if (t.closed || poll.closedAt !== null) {
    return err('closed');
  }
  const allowed = new Set(poll.options.map((option) => option.id));
  const unique: PollOptionId[] = [];
  const seen = new Set<PollOptionId>();
  for (const optionId of optionIds) {
    if (!allowed.has(optionId)) {
      return err('unknown-option');
    }
    if (seen.has(optionId)) {
      continue;
    }
    seen.add(optionId);
    unique.push(optionId);
  }
  if (unique.length > 1 && !poll.multiple) {
    return err('multiple-not-allowed');
  }
  const voters: Record<PollOptionId, readonly UserId[]> = {};
  const totals: Record<PollOptionId, number> = {};
  for (const option of poll.options) {
    const remaining = (t.voters[option.id] ?? []).filter((id) => id !== userId);
    const nextVoters = unique.includes(option.id) ? [...remaining, userId] : remaining;
    voters[option.id] = nextVoters;
    totals[option.id] = nextVoters.length;
  }
  return ok({ totals, voters, closed: false });
}
