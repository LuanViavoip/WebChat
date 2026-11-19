import type { IsoInstant, QuickReplyId } from './ids';
import type { IlhaId, UserId } from './identity';
import type { TenantId } from './tenant';

export type QuickReplyScope =
  | { readonly kind: 'personal'; readonly ownerId: UserId }
  | { readonly kind: 'ilha'; readonly ilhaId: IlhaId }
  | { readonly kind: 'tenant' };

export type QuickReply = {
  readonly id: QuickReplyId;
  readonly tenantId: TenantId;
  readonly shortcut: string;
  readonly text: string;
  readonly scope: QuickReplyScope;
  readonly updatedAt: IsoInstant;
};

export const SHORTCUT_PATTERN = /^\/[a-z0-9][a-z0-9-]{0,23}$/;

export type SaveQuickReplyRequest = {
  readonly id?: QuickReplyId;
  readonly shortcut: string;
  readonly text: string;
  readonly scope: QuickReplyScope;
};

export type QuickReplyDenial = 'bad-shortcut' | 'empty' | 'too-long' | 'duplicate-shortcut' | 'scope-forbidden';
