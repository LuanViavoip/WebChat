export const rooms = {
  conversation: (tenantId: string, conversationId: string) =>
    `tenant:${tenantId}:conversation:${conversationId}`,
  queue: (tenantId: string, queueId: string) => `tenant:${tenantId}:queue:${queueId}`,
  agent: (tenantId: string, agentId: string) => `tenant:${tenantId}:agent:${agentId}`,
  session: (sessionId: string) => `session:${sessionId}`,
  supervisors: (tenantId: string) => `tenant:${tenantId}:supervisors`,
  supervisorQueue: (tenantId: string, queueId: string) => `tenant:${tenantId}:supervisors:queue:${queueId}`,
  internal: (tenantId: string, conversationId: string) => `tenant:${tenantId}:internal:${conversationId}`,
  sector: (tenantId: string, sectorId: string) => `tenant:${tenantId}:sector:${sectorId}`,
};
