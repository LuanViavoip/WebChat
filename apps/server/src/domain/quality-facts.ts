export type ConversationTimelineEvent = {
  conversationId: string;
  type:
    | 'queued'
    | 'assigned'
    | 'released'
    | 'transferred'
    | 'left'
    | 'classified'
    | 'survey_submitted'
    | 'closed';
  at: string;
  payload: Record<string, string>;
};

export type AgentReplyMark = {
  conversationId: string;
  agentId: string;
  at: string;
};

export type QueueWaitFact =
  | {
      kind: 'completed';
      conversationId: string;
      queueId: string;
      startedAt: string;
      assignedAt: string;
      elapsedSeconds: number;
    }
  | {
      kind: 'abandoned';
      conversationId: string;
      queueId: string;
      startedAt: string;
      leftAt: string;
      elapsedSeconds: number;
    }
  | { kind: 'open'; conversationId: string; queueId: string; startedAt: string }
  | { kind: 'unreadable'; conversationId: string; reason: 'missing_queue' };

export type FirstResponseFact =
  | { kind: 'answered'; conversationId: string; queueId: string; elapsedSeconds: number }
  | { kind: 'closed_without_reply'; conversationId: string; queueId: string }
  | {
      kind: 'handed_off_without_reply';
      conversationId: string;
      queueId: string;
      end: 'transferred' | 'released';
    }
  | { kind: 'still_open'; conversationId: string; queueId: string }
  | { kind: 'unreadable'; conversationId: string; reason: 'missing_queue' };

export type HandleTimeFact =
  | {
      kind: 'closed_segment';
      conversationId: string;
      queueId: string;
      elapsedSeconds: number;
      end: 'released' | 'transferred' | 'classified';
    }
  | { kind: 'still_open'; conversationId: string; queueId: string }
  | { kind: 'unreadable'; conversationId: string; reason: 'missing_queue' };

export type OperationalFacts = {
  queueWaits: QueueWaitFact[];
  firstResponses: FirstResponseFact[];
  handleTimes: HandleTimeFact[];
};

export type SlaPolicyVersion = {
  queueId: string;
  effectiveFrom: string;
  retiredAt: string | null;
  queueWaitThresholdSeconds: number;
  firstResponseThresholdSeconds: number;
};

export type SlaJudgement =
  | { outcome: 'within'; elapsedSeconds: number; thresholdSeconds: number }
  | {
      outcome: 'breached';
      thresholdSeconds: number;
      elapsed: { kind: 'measured'; elapsedSeconds: number } | { kind: 'no_reply' };
    }
  | {
      outcome: 'not_applicable';
      reason: 'no_policy' | 'still_open' | 'abandoned' | 'handed_off' | 'unreadable';
    };

export function reconstructOperationalFacts(input: {
  events: readonly ConversationTimelineEvent[];
  agentReplies: readonly AgentReplyMark[];
  window: { from: string; to: string };
}): OperationalFacts {
  void input;
  throw new Error('not implemented');
}

export function policyAt(
  versions: readonly SlaPolicyVersion[],
  queueId: string,
  at: string,
): SlaPolicyVersion | null {
  void versions;
  void queueId;
  void at;
  throw new Error('not implemented');
}

export function judgeQueueWait(
  fact: QueueWaitFact,
  policy: { thresholdSeconds: number } | null,
): SlaJudgement {
  void fact;
  void policy;
  throw new Error('not implemented');
}

export function judgeFirstResponse(
  fact: FirstResponseFact,
  policy: { thresholdSeconds: number } | null,
): SlaJudgement {
  void fact;
  void policy;
  throw new Error('not implemented');
}
