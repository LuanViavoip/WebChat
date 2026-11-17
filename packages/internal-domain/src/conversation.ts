import type { Directory, IlhaId, StaffUser, UserId } from './identity';
import { supervisorsOf } from './identity';
import { own } from './records';
import { err, ok, type Result } from './result';
import type { Brand, TenantId } from './tenant';

export type ConversationId = Brand<string, 'ConversationId'>;
/** Dois ids distintos, ordenados. */
export type DirectPair = Brand<readonly [UserId, UserId], 'DirectPair'>;

export type DirectConversation = {
  readonly kind: 'direct';
  /** `dm:${tenantId}:${menor}:${maior}` */
  readonly id: ConversationId;
  readonly tenantId: TenantId;
  readonly participants: DirectPair;
};

/**
 * Origem do grupo (plano da fusão, C6/D8):
 * - `ilha`: o grupo automático da ilha (setor); membros só pela sincronização da ilha, sem edição manual;
 * - `custom`: criado por admin/supervisor (Etapa 6); segue as regras de grupo.
 */
export type GroupOrigin =
  | { readonly kind: 'ilha'; readonly ilhaId: IlhaId }
  | { readonly kind: 'custom'; readonly createdBy: UserId };

/** Só o tipo nesta etapa: sem fluxo de criação de grupo (Etapa 6). */
export type GroupConversation = {
  readonly kind: 'group';
  readonly id: ConversationId;
  readonly tenantId: TenantId;
  readonly title: string;
  readonly origin: GroupOrigin;
  readonly members: readonly [UserId, ...UserId[]];
  readonly createdAt: string;
};

/** Membros de grupo de ilha vêm só da sincronização da ilha; só o grupo custom aceita edição manual de membros. */
export function membersEditableManually(group: GroupConversation): boolean {
  return group.origin.kind === 'custom';
}

export type Conversation = DirectConversation | GroupConversation;

/** Conversão não verificada, para ids vindos de fora do domínio (testes, adaptadores). */
export function asConversationId(value: string): ConversationId {
  return value as ConversationId;
}

export function directConversationId(tenantId: TenantId, a: UserId, b: UserId): ConversationId {
  const [low, high] = orderedPair(a, b);
  return `dm:${tenantId}:${low}:${high}` as ConversationId;
}

function orderedPair(a: UserId, b: UserId): [UserId, UserId] {
  return a < b ? [a, b] : [b, a];
}

export function directConversation(
  a: StaffUser,
  b: StaffUser,
): Result<DirectConversation, 'same-user' | 'cross-tenant'> {
  // Identidade é (tenantId, id): o tenant vem primeiro; mesmo id em tenants diferentes é cross-tenant.
  if (a.tenantId !== b.tenantId) {
    return err('cross-tenant');
  }
  if (a.id === b.id) {
    return err('same-user');
  }
  return ok({
    kind: 'direct',
    id: directConversationId(a.tenantId, a.id, b.id),
    tenantId: a.tenantId,
    participants: orderedPair(a.id, b.id) as unknown as DirectPair,
  });
}

export type ConversationSummary = {
  readonly id: ConversationId;
  readonly conversation: Conversation;
  /** ISO 8601 da última atividade. */
  readonly lastActivityAt: string;
  readonly preview?: string;
  readonly unread: number;
};

/** 'priority' = grupos + direta com quem supervisiona/é supervisionado. */
export type ConversationTier = 'priority' | 'colleagues';

/**
 * Regras da seção "Grupos e supervisão":
 * - conversa de outro tenant (não deveria chegar aqui): colleagues;
 * - grupo: sempre priority;
 * - agente: a direta com o supervisor de qualquer ilha dele;
 * - supervisor: as diretas com os agentes de alguma ilha dele;
 * - admin: as diretas com supervisores (decisão: o admin "supervisiona" supervisores).
 * Todo o resto (inclusive supervisor com admin ou com outro supervisor) é colega.
 */
export function conversationTier(c: Conversation, me: StaffUser, d: Directory): ConversationTier {
  if (c.tenantId !== me.tenantId || c.tenantId !== d.tenantId) {
    return 'colleagues';
  }
  if (c.kind === 'group') {
    return 'priority';
  }
  const [first, second] = c.participants;
  if (first !== me.id && second !== me.id) {
    return 'colleagues';
  }
  const otherId = first === me.id ? second : first;
  const other = own(d.users, otherId);
  if (!other) {
    return 'colleagues';
  }
  switch (me.role) {
    case 'agent':
      return supervisorsOf(d, me).some((supervisor) => supervisor.id === other.id) ? 'priority' : 'colleagues';
    case 'supervisor':
      return other.role === 'agent' && supervisorsOf(d, other).some((supervisor) => supervisor.id === me.id) ? 'priority' : 'colleagues';
    case 'admin':
      return other.role === 'supervisor' ? 'priority' : 'colleagues';
  }
}

export function sortConversations(
  items: readonly ConversationSummary[],
  me: StaffUser,
  d: Directory,
): { readonly priority: readonly ConversationSummary[]; readonly colleagues: readonly ConversationSummary[] } {
  const nameOf = (item: ConversationSummary): string => {
    const c = item.conversation;
    if (c.kind === 'group') {
      return c.title;
    }
    const otherId = c.participants[0] === me.id ? c.participants[1] : c.participants[0];
    return own(d.users, otherId)?.name ?? '';
  };
  // Com mensagem: última atividade desc. Sem nenhuma mensagem: depois, por nome.
  const byActivity = (a: ConversationSummary, b: ConversationSummary): number => {
    const aEmpty = !a.preview;
    const bEmpty = !b.preview;
    if (aEmpty !== bEmpty) {
      return aEmpty ? 1 : -1;
    }
    if (aEmpty) {
      const byName = nameOf(a).localeCompare(nameOf(b), 'pt-BR');
      return byName !== 0 ? byName : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    }
    const diff = Date.parse(b.lastActivityAt) - Date.parse(a.lastActivityAt);
    if (diff !== 0 && !Number.isNaN(diff)) {
      return diff;
    }
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  };
  const priority: ConversationSummary[] = [];
  const colleagues: ConversationSummary[] = [];
  for (const item of items) {
    (conversationTier(item.conversation, me, d) === 'priority' ? priority : colleagues).push(item);
  }
  return { priority: priority.sort(byActivity), colleagues: colleagues.sort(byActivity) };
}
