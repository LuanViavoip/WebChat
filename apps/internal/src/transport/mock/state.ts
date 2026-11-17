import { CAPABILITIES } from '@viavoip/internal-domain';
import type { Conversation, ConversationId } from '@viavoip/internal-domain';
import type { GrantLogEntry } from '@viavoip/internal-domain';
import {
  parseStaffUser,
  validateDirectory,
  type Directory,
  type Ilha,
  type IlhaId,
  type LoginRecord,
  type StaffUser,
  type UserId,
} from '@viavoip/internal-domain';
import type { ChatMessage } from '@viavoip/internal-domain';
import type { Tenant, TenantId } from '@viavoip/internal-domain';

/** Uma partição: tudo que pertence a UMA empresa. Nada aqui referencia outro tenant. */
export type TenantState = {
  tenant: Tenant;
  directory: Directory;
  conversations: Record<ConversationId, Conversation>;
  createdAt: Record<ConversationId, string>;
  messages: Record<ConversationId, ChatMessage[]>;
  /** Último id lido por usuário, por conversa. */
  reads: Record<ConversationId, Record<UserId, string>>;
  logins: Record<UserId, LoginRecord>;
  /** Concessões e revogações aceitas (Etapa 5). Só cresce; só entradas deste tenant. */
  grantLog: GrantLogEntry[];
  /**
   * Época de sessão por usuário (só do servidor simulado; nunca vai ao cliente): sobe a cada desativação.
   * Ausente = 0. Sessão aberta com época menor que a atual foi encerrada por uma desativação e não volta,
   * mesmo que a conta seja reativada: reativar só permite um login NOVO.
   */
  sessionEpochs: Record<UserId, number>;
  /** Contador dos ids de mensagem. */
  seq: number;
};

export type ServerState = Map<TenantId, TenantState>;

/**
 * v5: ilha N:N (`Agent.ilhaIds`, `Ilha.supervisorIds`, `GroupConversation.origin`). As v4/v3/v2 (1:1: `ilhaId`,
 * `supervisorId`) ainda carregam e são MIGRADAS (um vínculo vira lista de um; grupo antigo vira `custom`).
 * v4: o tenant ganha `sessionEpochs`; a v3 (sem épocas) e a v2 (sem grantLog) carregam com época 0 e, na v2, log vazio.
 */
export const PERSIST_VERSION = 5;
const OLDER_VERSIONS: readonly unknown[] = [4, 3, 2];

type PersistedUser = Omit<StaffUser, 'grants'> & { grants: string[] };
type PersistedTenant = Omit<TenantState, 'directory'> & {
  directory: { tenantId: TenantId; users: Record<string, PersistedUser>; ilhas: Record<IlhaId, Ilha> };
};

/** Estado serializável (JSON puro): `grants` vira array. */
export type PersistedState = { version: typeof PERSIST_VERSION; tenants: PersistedTenant[] };

export function toPersisted(state: ServerState): PersistedState {
  const tenants = [...state.values()].map((tenant) => {
    const users: Record<string, PersistedUser> = {};
    for (const [id, user] of Object.entries(tenant.directory.users)) {
      users[id] = { ...user, grants: [...user.grants] };
    }
    return {
      ...tenant,
      directory: { tenantId: tenant.directory.tenantId, users, ilhas: tenant.directory.ilhas },
    };
  });
  return JSON.parse(JSON.stringify({ version: PERSIST_VERSION, tenants })) as PersistedState;
}

/** Valida o que veio do storage. Qualquer incoerência devolve undefined (o chamador recria a seed). */
export function fromPersisted(raw: unknown): ServerState | undefined {
  if (typeof raw !== 'object' || raw === null) {
    return undefined;
  }
  const { version, tenants } = raw as { version?: unknown; tenants?: unknown };
  if ((version !== PERSIST_VERSION && !OLDER_VERSIONS.includes(version)) || !Array.isArray(tenants)) {
    return undefined;
  }
  const state: ServerState = new Map();
  for (const item of tenants as unknown[]) {
    const parsed = parseTenant(item, version === 2, version !== PERSIST_VERSION);
    if (!parsed) {
      return undefined;
    }
    state.set(parsed.tenant.id, parsed);
  }
  return state.size > 0 ? state : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** 1:1 -> N:N, sem mutar a entrada. Só converte o campo antigo quando o novo está ausente. */
function upgradeCardinality(raw: Record<string, unknown>): Record<string, unknown> {
  const dir = raw.directory;
  const convUsers = (users: unknown): unknown => {
    if (!isRecord(users)) return users;
    return Object.fromEntries(
      Object.entries(users).map(([id, u]) => {
        if (isRecord(u) && u.role === 'agent' && typeof u.ilhaId === 'string' && !('ilhaIds' in u)) {
          const { ilhaId, ...rest } = u;
          return [id, { ...rest, ilhaIds: [ilhaId] }];
        }
        return [id, u];
      }),
    );
  };
  const convIlhas = (ilhas: unknown): unknown => {
    if (!isRecord(ilhas)) return ilhas;
    return Object.fromEntries(
      Object.entries(ilhas).map(([id, i]) => {
        if (isRecord(i) && typeof i.supervisorId === 'string' && !('supervisorIds' in i)) {
          const { supervisorId, ...rest } = i;
          return [id, { ...rest, supervisorIds: [supervisorId] }];
        }
        return [id, i];
      }),
    );
  };
  const convConversations = (conversations: unknown): unknown => {
    if (!isRecord(conversations)) return conversations;
    return Object.fromEntries(
      Object.entries(conversations).map(([id, c]) => {
        if (isRecord(c) && c.kind === 'group' && !('origin' in c) && typeof c.createdBy === 'string') {
          const rest = Object.fromEntries(Object.entries(c).filter(([key]) => key !== 'createdBy' && key !== 'ilhaId'));
          return [id, { ...rest, origin: { kind: 'custom', createdBy: c.createdBy } }];
        }
        return [id, c];
      }),
    );
  };
  return {
    ...raw,
    directory: isRecord(dir) ? { ...dir, users: convUsers(dir.users), ilhas: convIlhas(dir.ilhas) } : dir,
    conversations: convConversations(raw.conversations),
  };
}

function parseTenant(input: unknown, legacy: boolean, upgrade: boolean): TenantState | undefined {
  const raw = upgrade && isRecord(input) ? upgradeCardinality(input) : input;
  if (!isRecord(raw) || !isRecord(raw.tenant) || !isRecord(raw.directory)) {
    return undefined;
  }
  const { tenant, directory, conversations, createdAt, messages, reads, logins, seq } = raw;
  const grantLog = legacy ? [] : raw.grantLog;
  const sessionEpochs = raw.sessionEpochs ?? {};
  if (
    typeof tenant.id !== 'string' ||
    typeof tenant.name !== 'string' ||
    typeof tenant.timeZone !== 'string' ||
    !isRecord(directory.users) ||
    !isRecord(directory.ilhas) ||
    !isRecord(conversations) ||
    !isRecord(createdAt) ||
    !isRecord(messages) ||
    !isRecord(reads) ||
    !isRecord(logins) ||
    !Array.isArray(grantLog) ||
    !isRecord(sessionEpochs) ||
    typeof seq !== 'number'
  ) {
    return undefined;
  }
  // Forma das ilhas antes de qualquer função do domínio (storage adulterável): `supervisorIds` é lista de strings.
  for (const ilha of Object.values(directory.ilhas)) {
    if (!isRecord(ilha) || !Array.isArray(ilha.supervisorIds) || !(ilha.supervisorIds as unknown[]).every(str)) {
      return undefined;
    }
  }
  const users: Record<string, StaffUser> = {};
  for (const [id, item] of Object.entries(directory.users)) {
    const user = parseStaffUser(item);
    if ('error' in user) {
      return undefined;
    }
    users[id] = user;
  }
  const tenantId = tenant.id as TenantId;
  const dir: Directory = {
    tenantId,
    users: users,
    ilhas: directory.ilhas as Directory['ilhas'],
  };
  // Inclui exatamente um admin ativo: estado sem ele é incoerente como qualquer outro (o mock recria a seed).
  if (!validateDirectory(dir).ok) {
    return undefined;
  }
  const state: TenantState = {
    tenant: { id: tenantId, name: tenant.name, timeZone: tenant.timeZone },
    directory: dir,
    conversations: conversations as TenantState['conversations'],
    createdAt: createdAt as TenantState['createdAt'],
    messages: messages as TenantState['messages'],
    reads: reads as TenantState['reads'],
    logins: logins as TenantState['logins'],
    grantLog: grantLog as TenantState['grantLog'],
    sessionEpochs: sessionEpochs as TenantState['sessionEpochs'],
    seq,
  };
  return coherent(state) ? state : undefined;
}

function str(value: unknown): value is string {
  return typeof value === 'string' && value !== '';
}

/** Tudo que o storage (adulterável) afirma precisa fechar com o tenant, o diretório e entre si. */
function coherent(ts: TenantState): boolean {
  const tenantId = ts.tenant.id;
  const users = ts.directory.users;
  const hasUser = (id: unknown): boolean => str(id) && Object.hasOwn(users, id) && users[id as UserId]?.tenantId === tenantId;
  for (const [key, ilha] of Object.entries(ts.directory.ilhas)) {
    if (
      !isRecord(ilha) ||
      ilha.id !== key ||
      ilha.tenantId !== tenantId ||
      !Array.isArray(ilha.supervisorIds) ||
      !(ilha.supervisorIds as unknown[]).every(hasUser)
    ) {
      return false;
    }
  }
  for (const [key, user] of Object.entries(users)) {
    if (user.id !== key || user.tenantId !== tenantId) {
      return false;
    }
  }
  const known = new Set<string>(CAPABILITIES);
  for (const raw of ts.grantLog as unknown[]) {
    if (
      !isRecord(raw) ||
      raw.tenantId !== tenantId ||
      !hasUser(raw.actorId) ||
      !hasUser(raw.targetId) ||
      typeof raw.capability !== 'string' ||
      !known.has(raw.capability) ||
      typeof raw.granted !== 'boolean' ||
      !str(raw.at)
    ) {
      return false;
    }
  }
  const participants = new Map<string, readonly string[]>();
  for (const [key, raw] of Object.entries(ts.conversations)) {
    const conversation: unknown = raw;
    if (!isRecord(conversation) || conversation.id !== key || conversation.tenantId !== tenantId) {
      return false;
    }
    let people: unknown;
    if (conversation.kind === 'direct') {
      people = conversation.participants;
      if (!Array.isArray(people) || people.length !== 2 || people[0] === people[1]) {
        return false;
      }
    } else if (conversation.kind === 'group') {
      people = conversation.members;
      if (!Array.isArray(people) || people.length === 0) {
        return false;
      }
      const origin = conversation.origin;
      const originOk =
        isRecord(origin) &&
        ((origin.kind === 'ilha' && str(origin.ilhaId) && Object.hasOwn(ts.directory.ilhas, origin.ilhaId)) ||
          (origin.kind === 'custom' && hasUser(origin.createdBy)));
      if (!originOk) {
        return false;
      }
    } else {
      return false;
    }
    if (!(people as unknown[]).every(hasUser) || !str(ts.createdAt[key as ConversationId])) {
      return false;
    }
    participants.set(key, people as string[]);
  }
  for (const key of [...Object.keys(ts.messages), ...Object.keys(ts.reads), ...Object.keys(ts.createdAt)]) {
    if (!participants.has(key)) {
      return false;
    }
  }
  const seen = new Set<string>();
  for (const [key, list] of Object.entries(ts.messages)) {
    if (!Array.isArray(list)) {
      return false;
    }
    for (const message of list as unknown[]) {
      if (
        !isRecord(message) ||
        !str(message.id) ||
        seen.has(message.id) ||
        message.tenantId !== tenantId ||
        message.conversationId !== key ||
        !hasUser(message.authorId) ||
        !participants.get(key)?.includes(message.authorId as string)
      ) {
        return false;
      }
      seen.add(message.id);
    }
  }
  for (const [key, byUser] of Object.entries(ts.reads)) {
    if (!isRecord(byUser)) {
      return false;
    }
    for (const [userId, messageId] of Object.entries(byUser)) {
      const list = ts.messages[key as ConversationId] ?? [];
      if (!participants.get(key)?.includes(userId) || !list.some((message) => message.id === messageId)) {
        return false;
      }
    }
  }
  for (const [userId, epoch] of Object.entries(ts.sessionEpochs)) {
    if (!hasUser(userId) || typeof epoch !== 'number' || !Number.isSafeInteger(epoch) || epoch < 0) {
      return false;
    }
  }
  for (const [userId, login] of Object.entries(ts.logins)) {
    if (!isRecord(login) || login.userId !== userId || !hasUser(userId)) {
      return false;
    }
  }
  return true;
}

/** Texto estável de um diretório (Set vira lista ordenada): serve para saber se algo mudou. */
export function directoryFingerprint(d: Directory): string {
  return JSON.stringify(d, (_key, value: unknown) => (value instanceof Set ? Array.from(value, (item: unknown) => String(item)).sort() : value));
}
