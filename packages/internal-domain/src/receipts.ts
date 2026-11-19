import type { IsoInstant, MessageId } from './ids';
import type { UserId } from './identity';
import type { MessageStatus } from './message';

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

/** Status agregado: delivered quando todos entregues; read quando todos leram (regra da Etapa 6). */
export function aggregateStatus(r: MessageReceipts, base: 'sent' | 'error'): MessageStatus {
  if (base === 'error') {
    return 'error';
  }
  if (r.recipients.length === 0) {
    return 'sent';
  }
  const allRead = r.recipients.every((recipient) => recipient.readAt !== null);
  if (allRead) {
    return 'read';
  }
  const allDelivered = r.recipients.every(
    (recipient) => recipient.deliveredAt !== null || recipient.readAt !== null,
  );
  return allDelivered ? 'delivered' : 'sent';
}
