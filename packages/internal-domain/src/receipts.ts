import type { IsoInstant, MessageId } from './ids';
import type { UserId } from './identity';

export type RecipientReceipt = {
  readonly userId: UserId;
  readonly deliveredAt: IsoInstant | null;
  readonly readAt: IsoInstant | null;
};

export type MessageReceipts = {
  readonly messageId: MessageId;
  /** Membros ATUAIS menos o autor (ex-membros ficam fora). */
  readonly recipients: readonly RecipientReceipt[];
};
