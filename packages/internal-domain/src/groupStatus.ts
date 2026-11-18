import type { UserId } from './identity';

/** A leitura só é confirmada quando todos os destinatários alcançam a mensagem. */
export function groupMessageRead(members: readonly UserId[], author: UserId, messageId: string, messages: readonly { id: string }[], reads: Readonly<Partial<Record<UserId, string>>>): boolean {
  const index = messages.findIndex((message) => message.id === messageId);
  if (index < 0) return false;
  return members.filter((member) => member !== author).every((member) => {
    const cursor = reads[member];
    return cursor !== undefined && messages.findIndex((message) => message.id === cursor) >= index;
  });
}

