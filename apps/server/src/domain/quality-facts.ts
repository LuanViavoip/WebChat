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
  | { kind: 'answered'; conversationId: string; queueId: string; at: string; elapsedSeconds: number }
  | { kind: 'closed_without_reply'; conversationId: string; queueId: string; at: string }
  | {
      kind: 'handed_off_without_reply';
      conversationId: string;
      queueId: string;
      at: string;
      end: 'transferred' | 'released';
    }
  | { kind: 'still_open'; conversationId: string; queueId: string; at: string }
  | { kind: 'unreadable'; conversationId: string; reason: 'missing_queue' };

export type HandleTimeFact =
  | {
      kind: 'closed_segment';
      conversationId: string;
      queueId: string;
      elapsedSeconds: number;
      end: 'released' | 'transferred' | 'classified';
    }
  | { kind: 'still_open'; conversationId: string; queueId: string; startedAt: string }
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
  const from = Date.parse(input.window.from);
  const to = Date.parse(input.window.to);
  const grouped = new Map<string, ConversationTimelineEvent[]>();
  for (const event of input.events) {
    const list = grouped.get(event.conversationId) ?? [];
    list.push(event);
    grouped.set(event.conversationId, list);
  }
  const queueWaits: QueueWaitFact[] = [];
  const firstResponses: FirstResponseFact[] = [];
  const handleTimes: HandleTimeFact[] = [];
  for (const [conversationId, events] of grouped) {
    const ordered = [...events].sort((left, right) => Date.parse(left.at) - Date.parse(right.at));
    const replies = input.agentReplies
      .filter((reply) => reply.conversationId === conversationId)
      .sort((left, right) => Date.parse(left.at) - Date.parse(right.at));
    let openWait: { queueId: string | null; startedAt: string } | null = null;
    let lastQueue: string | null = null;
    const assignments: { at: string; queueId: string | null; agentId: string | null; closedAt: string | null; end: 'released' | 'transferred' | 'classified' | null }[] = [];
    for (const event of ordered) {
      if (event.type === 'queued') {
        lastQueue = event.payload.queueId ?? lastQueue;
        openWait = { queueId: event.payload.queueId ?? null, startedAt: event.at };
      } else if (event.type === 'released') {
        openWait = { queueId: lastQueue, startedAt: event.at };
        closeAssignment(assignments, event.at, 'released');
      } else if (event.type === 'transferred') {
        lastQueue = event.payload.toQueueId ?? lastQueue;
        openWait = { queueId: event.payload.toQueueId ?? null, startedAt: event.at };
        closeAssignment(assignments, event.at, 'transferred');
      } else if (event.type === 'assigned') {
        const queueId = openWait?.queueId ?? lastQueue;
        const startedAt = openWait?.startedAt ?? event.at;
        if (!queueId) queueWaits.push({ kind: 'unreadable', conversationId, reason: 'missing_queue' });
        else {
          queueWaits.push({
            kind: 'completed',
            conversationId,
            queueId,
            startedAt,
            assignedAt: event.at,
            elapsedSeconds: elapsed(startedAt, event.at),
          });
        }
        openWait = null;
        assignments.push({ at: event.at, queueId, agentId: event.payload.agentId ?? null, closedAt: null, end: null });
      } else if (event.type === 'left') {
        if (!openWait?.queueId) queueWaits.push({ kind: 'unreadable', conversationId, reason: 'missing_queue' });
        else {
          queueWaits.push({
            kind: 'abandoned',
            conversationId,
            queueId: openWait.queueId,
            startedAt: openWait.startedAt,
            leftAt: event.at,
            elapsedSeconds: elapsed(openWait.startedAt, event.at),
          });
        }
        openWait = null;
      } else if (event.type === 'classified') {
        closeAssignment(assignments, event.at, 'classified');
      }
    }
    if (openWait?.queueId) {
      queueWaits.push({ kind: 'open', conversationId, queueId: openWait.queueId, startedAt: openWait.startedAt });
    } else if (openWait) {
      queueWaits.push({ kind: 'unreadable', conversationId, reason: 'missing_queue' });
    }
    for (const assignment of assignments) {
      if (!inside(assignment.at, from, to)) continue;
      if (!assignment.queueId) {
        firstResponses.push({ kind: 'unreadable', conversationId, reason: 'missing_queue' });
        handleTimes.push({ kind: 'unreadable', conversationId, reason: 'missing_queue' });
        continue;
      }
      const reply = replies.find((item) => {
        const at = Date.parse(item.at);
        return at >= Date.parse(assignment.at) && (assignment.closedAt === null || at < Date.parse(assignment.closedAt));
      });
      if (reply) {
        firstResponses.push({
          kind: 'answered',
          conversationId,
          queueId: assignment.queueId,
          at: assignment.at,
          elapsedSeconds: elapsed(assignment.at, reply.at),
        });
      } else if (assignment.end === 'classified') {
        firstResponses.push({ kind: 'closed_without_reply', conversationId, queueId: assignment.queueId, at: assignment.at });
      } else if (assignment.end === 'released' || assignment.end === 'transferred') {
        firstResponses.push({
          kind: 'handed_off_without_reply',
          conversationId,
          queueId: assignment.queueId,
          at: assignment.at,
          end: assignment.end,
        });
      } else {
        firstResponses.push({ kind: 'still_open', conversationId, queueId: assignment.queueId, at: assignment.at });
      }
      if (assignment.closedAt && assignment.end) {
        handleTimes.push({
          kind: 'closed_segment',
          conversationId,
          queueId: assignment.queueId,
          elapsedSeconds: elapsed(assignment.at, assignment.closedAt),
          end: assignment.end,
        });
      } else {
        handleTimes.push({ kind: 'still_open', conversationId, queueId: assignment.queueId, startedAt: assignment.at });
      }
    }
  }
  return {
    queueWaits: queueWaits.filter((fact) => queueWaitInWindow(fact, from, to)),
    firstResponses,
    handleTimes: handleTimes.filter((fact) => handleInWindow(fact, from, to)),
  };
}

export function policyAt(
  versions: readonly SlaPolicyVersion[],
  queueId: string,
  at: string,
): SlaPolicyVersion | null {
  const instant = Date.parse(at);
  const matches = versions.filter((version) => {
    if (version.queueId !== queueId) return false;
    if (Date.parse(version.effectiveFrom) > instant) return false;
    return version.retiredAt === null || instant < Date.parse(version.retiredAt);
  });
  return matches.sort((left, right) => Date.parse(right.effectiveFrom) - Date.parse(left.effectiveFrom))[0] ?? null;
}

export function judgeQueueWait(
  fact: QueueWaitFact,
  policy: { thresholdSeconds: number } | null,
): SlaJudgement {
  switch (fact.kind) {
    case 'completed':
      if (!policy) return { outcome: 'not_applicable', reason: 'no_policy' };
      if (fact.elapsedSeconds <= policy.thresholdSeconds) {
        return { outcome: 'within', elapsedSeconds: fact.elapsedSeconds, thresholdSeconds: policy.thresholdSeconds };
      }
      return {
        outcome: 'breached',
        thresholdSeconds: policy.thresholdSeconds,
        elapsed: { kind: 'measured', elapsedSeconds: fact.elapsedSeconds },
      };
    case 'abandoned':
      return { outcome: 'not_applicable', reason: 'abandoned' };
    case 'open':
      return { outcome: 'not_applicable', reason: 'still_open' };
    case 'unreadable':
      return { outcome: 'not_applicable', reason: 'unreadable' };
    default: {
      const unexpected: never = fact;
      return unexpected;
    }
  }
}

export function judgeFirstResponse(
  fact: FirstResponseFact,
  policy: { thresholdSeconds: number } | null,
): SlaJudgement {
  switch (fact.kind) {
    case 'answered':
      if (!policy) return { outcome: 'not_applicable', reason: 'no_policy' };
      if (fact.elapsedSeconds <= policy.thresholdSeconds) {
        return { outcome: 'within', elapsedSeconds: fact.elapsedSeconds, thresholdSeconds: policy.thresholdSeconds };
      }
      return {
        outcome: 'breached',
        thresholdSeconds: policy.thresholdSeconds,
        elapsed: { kind: 'measured', elapsedSeconds: fact.elapsedSeconds },
      };
    case 'closed_without_reply':
      if (!policy) return { outcome: 'not_applicable', reason: 'no_policy' };
      return { outcome: 'breached', thresholdSeconds: policy.thresholdSeconds, elapsed: { kind: 'no_reply' } };
    case 'handed_off_without_reply':
      return { outcome: 'not_applicable', reason: 'handed_off' };
    case 'still_open':
      return { outcome: 'not_applicable', reason: 'still_open' };
    case 'unreadable':
      return { outcome: 'not_applicable', reason: 'unreadable' };
    default: {
      const unexpected: never = fact;
      return unexpected;
    }
  }
}

function closeAssignment(
  assignments: { closedAt: string | null; end: 'released' | 'transferred' | 'classified' | null }[],
  at: string,
  end: 'released' | 'transferred' | 'classified',
): void {
  const open = [...assignments].reverse().find((item) => item.closedAt === null);
  if (!open) return;
  open.closedAt = at;
  open.end = end;
}

function elapsed(start: string, end: string): number {
  return Math.max(0, Math.floor((Date.parse(end) - Date.parse(start)) / 1000));
}

function inside(iso: string, from: number, to: number): boolean {
  const at = Date.parse(iso);
  return at >= from && at < to;
}

function queueWaitInWindow(fact: QueueWaitFact, from: number, to: number): boolean {
  switch (fact.kind) {
    case 'completed':
      return inside(fact.assignedAt, from, to);
    case 'abandoned':
      return inside(fact.leftAt, from, to);
    case 'open':
      return inside(fact.startedAt, from, to);
    case 'unreadable':
      return true;
    default: {
      const unexpected: never = fact;
      return unexpected;
    }
  }
}

function handleInWindow(fact: HandleTimeFact, from: number, to: number): boolean {
  switch (fact.kind) {
    case 'closed_segment':
      return true;
    case 'still_open':
      return inside(fact.startedAt, from, to);
    case 'unreadable':
      return true;
    default: {
      const unexpected: never = fact;
      return unexpected;
    }
  }
}
