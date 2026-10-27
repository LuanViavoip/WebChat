export function internalSectorLockKey(tenantId: string, sectorId: string): string {
  return `webchat:internal-sector:${tenantId}:${sectorId}`;
}

export function internalConversationLockKey(tenantId: string, conversationId: string): string {
  return `webchat:internal-conversation:${tenantId}:${conversationId}`;
}
