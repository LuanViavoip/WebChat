import type { ConversationId } from './conversation';
import type { IlhaId, UserId } from './identity';

/** v2.2 + 'ilhas' (N:N). Listas não vazias pelo tipo. */
export type Audience =
  | { readonly kind: 'all' }
  | { readonly kind: 'ilhas'; readonly ilhaIds: readonly [IlhaId, ...IlhaId[]] }
  | { readonly kind: 'groups'; readonly groupIds: readonly [ConversationId, ...ConversationId[]] }
  | { readonly kind: 'people'; readonly userIds: readonly [UserId, ...UserId[]] };

export type AudienceError = 'cross-tenant' | 'unknown-group' | 'unknown-user' | 'unknown-ilha' | 'empty';
