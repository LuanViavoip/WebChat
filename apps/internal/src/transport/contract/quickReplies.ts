import type { QuickReplyId } from '@viavoip/internal-domain';

export type {
  QuickReply,
  QuickReplyDenial,
  QuickReplyScope,
  SaveQuickReplyRequest,
} from '@viavoip/internal-domain';

export type DeleteQuickReplyRequest = { readonly id: QuickReplyId };
