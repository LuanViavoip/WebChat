import type { Conversation, ConversationId } from '../../domain/conversation';
import {
  parseStaffUser,
  validateDirectory,
  type Directory,
  type Ilha,
  type IlhaId,
  type LoginRecord,
  type StaffUser,
  type UserId,
} from '../../domain/identity';
import type { ChatMessage } from '../../domain/message';
import type { Tenant, TenantId } from '../../domain/tenant';

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
  /** Contador dos ids de mensagem. */
  seq: number;
};

export type ServerState = Map<TenantId, TenantState>;

export const PERSIST_VERSION = 2;

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
  if (version !== PERSIST_VERSION || !Array.isArray(tenants)) {
    return undefined;
  }
  const state: ServerState = new Map();
  for (const item of tenants as unknown[]) {
    const parsed = parseTenant(item);
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

function parseTenant(raw: unknown): TenantState | undefined {
  if (!isRecord(raw) || !isRecord(raw.tenant) || !isRecord(raw.directory)) {
    return undefined;
  }
  const { tenant, directory, conversations, createdAt, messages, reads, logins, seq } = raw;
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
    typeof seq !== 'number'
  ) {
    return undefined;
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
    if (!isRecord(ilha) || ilha.id !== key || ilha.tenantId !== tenantId || !hasUser(ilha.supervisorId)) {
      return false;
    }
  }
  for (const [key, user] of Object.entries(users)) {
    if (user.id !== key || user.tenantId !== tenantId) {
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
  for (const [userId, login] of Object.entries(ts.logins)) {
    if (!isRecord(login) || login.userId !== userId || !hasUser(userId)) {
      return false;
    }
  }
  return true;
}
