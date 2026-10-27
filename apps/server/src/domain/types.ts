import type { ConversationSummary } from '@viavoip/protocol';

export type VisitorPrincipal = {
  kind: 'visitor';
  tenantId: string;
  visitorId: string;
  siteId: string;
  sessionId: string;
};

export type AgentPrincipal = {
  kind: 'agent' | 'supervisor' | 'admin';
  tenantId: string;
  agentId: string;
  sessionId: string;
  name: string;
};

export type Principal = VisitorPrincipal | AgentPrincipal;

export type ConversationRecord = ConversationSummary & {
  siteId: string;
  version: number;
};
