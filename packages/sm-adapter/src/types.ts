export type SmConversationRef = {
  tenantId: string;
  conversationId: string;
  siteId: string;
  queueId: string;
};

export type SmAssignmentRef = SmConversationRef & {
  agentId: string;
};

export type SmClosureRef = SmConversationRef & {
  agentId: string;
  dispositionId: string;
};

export type SmReleaseRef = SmConversationRef & {
  agentId: string;
};

export type SmTransferRef = SmConversationRef & {
  fromQueueId: string;
  agentId: string;
};

export interface SMAdapter {
  onConversationQueued(input: SmConversationRef): Promise<void>;
  onConversationAssigned(input: SmAssignmentRef): Promise<void>;
  onConversationClosed(input: SmClosureRef): Promise<void>;
  onConversationReleased(input: SmReleaseRef): Promise<void>;
  onConversationTransferred(input: SmTransferRef): Promise<void>;
}
