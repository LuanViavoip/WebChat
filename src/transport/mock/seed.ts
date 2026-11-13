import { ROLE_DEFAULT } from '../../domain/capabilities';
import { directConversation, directConversationId, type ConversationId } from '../../domain/conversation';
import type { Agent, Directory, Ilha, IlhaId, StaffUser, Supervisor, UserId } from '../../domain/identity';
import type { ChatMessage, TextMessage } from '../../domain/message';
import type { Tenant, TenantId } from '../../domain/tenant';
import type { ConnectRequest } from '../ChatTransport';
import type { ServerState, TenantState } from './state';

const tid = (value: string): TenantId => value as TenantId;
const uid = (value: string): UserId => value as UserId;
const iid = (value: string): IlhaId => value as IlhaId;

/** Ids estáveis e legíveis: o e2e e o `?como=` dependem deles. */
export const ICS_TENANT_ID = tid('ics');
export const BV_TENANT_ID = tid('bv');

export const ICS_USERS = {
  marcos: uid('ics-marcos'),
  carla: uid('ics-carla'),
  rafael: uid('ics-rafael'),
  ana: uid('ics-ana'),
  bruno: uid('ics-bruno'),
  camila: uid('ics-camila'),
  diego: uid('ics-diego'),
  elisa: uid('ics-elisa'),
  fabio: uid('ics-fabio'),
} as const;

export const BV_USERS = {
  helena: uid('bv-helena'),
  otavio: uid('bv-otavio'),
  paula: uid('bv-paula'),
  rui: uid('bv-rui'),
} as const;

export const ICS_ILHAS = { norte: iid('ics-norte'), sul: iid('ics-sul'), exames: iid('ics-exames') } as const;
export const BV_ILHAS = { atendimento: iid('bv-atendimento') } as const;

export const ICS_TENANT: Tenant = { id: ICS_TENANT_ID, name: 'ICS Saúde', timeZone: 'America/Sao_Paulo' };
export const BV_TENANT: Tenant = { id: BV_TENANT_ID, name: 'Clínica Boa Vista', timeZone: 'America/Manaus' };

/** Usuário padrão da UI enquanto não há tela "Entrar como" (Bloco 4). */
export const DEFAULT_SESSION: ConnectRequest = { tenantId: ICS_TENANT_ID, userId: ICS_USERS.carla };

/** A conversa "ao vivo" da UI de conversa única: a direta real Carla ↔ Bruno (sem mensagens na seed). */
export const LIVE_CONVERSATION_ID: ConversationId = directConversationId(
  ICS_TENANT_ID,
  ICS_USERS.carla,
  ICS_USERS.bruno,
);
/** Uma segunda direta real da Carla, sem mensagens (troca de conversa nos testes). */
export const OTHER_CONVERSATION_ID: ConversationId = directConversationId(
  ICS_TENANT_ID,
  ICS_USERS.carla,
  ICS_USERS.camila,
);

function supervisor(tenantId: TenantId, id: UserId, name: string): Supervisor {
  return { id, tenantId, name, active: true, role: 'supervisor', grants: new Set(ROLE_DEFAULT.supervisor) };
}

function agent(tenantId: TenantId, id: UserId, name: string, ilhaId: IlhaId): Agent {
  return { id, tenantId, name, active: true, role: 'agent', ilhaId, grants: new Set(ROLE_DEFAULT.agent) };
}

function admin(tenantId: TenantId, id: UserId, name: string): StaffUser {
  return { id, tenantId, name, active: true, role: 'admin', grants: new Set(ROLE_DEFAULT.admin) };
}

function directoryOf(tenantId: TenantId, users: readonly StaffUser[], ilhas: readonly Ilha[]): Directory {
  return {
    tenantId,
    users: Object.fromEntries(users.map((user) => [user.id, user])),
    ilhas: Object.fromEntries(ilhas.map((ilha) => [ilha.id, ilha])),
  };
}

export function icsDirectory(): Directory {
  const t = ICS_TENANT_ID;
  const u = ICS_USERS;
  return directoryOf(
    t,
    [
      admin(t, u.marcos, 'Marcos Dono'),
      supervisor(t, u.carla, 'Carla Mendes'),
      supervisor(t, u.rafael, 'Rafael Lima'),
      agent(t, u.ana, 'Ana Souza', ICS_ILHAS.norte),
      agent(t, u.bruno, 'Bruno Costa', ICS_ILHAS.norte),
      agent(t, u.camila, 'Camila Ribeiro', ICS_ILHAS.sul),
      agent(t, u.diego, 'Diego Martins', ICS_ILHAS.sul),
      agent(t, u.elisa, 'Elisa Barbosa', ICS_ILHAS.exames),
      agent(t, u.fabio, 'Fábio Nunes', ICS_ILHAS.exames),
    ],
    [
      { id: ICS_ILHAS.norte, tenantId: t, name: 'Norte', supervisorId: u.carla },
      { id: ICS_ILHAS.sul, tenantId: t, name: 'Sul', supervisorId: u.carla },
      { id: ICS_ILHAS.exames, tenantId: t, name: 'Exames', supervisorId: u.rafael },
    ],
  );
}

export function bvDirectory(): Directory {
  const t = BV_TENANT_ID;
  const u = BV_USERS;
  return directoryOf(
    t,
    [
      admin(t, u.helena, 'Helena Prado'),
      supervisor(t, u.otavio, 'Otávio Reis'),
      agent(t, u.paula, 'Paula Teixeira', BV_ILHAS.atendimento),
      agent(t, u.rui, 'Rui Cardoso', BV_ILHAS.atendimento),
    ],
    [{ id: BV_ILHAS.atendimento, tenantId: t, name: 'Atendimento', supervisorId: u.otavio }],
  );
}

type SeedLine = { from: StaffUser; text: string; minutesAgo: number };

function emptyTenant(tenant: Tenant, directory: Directory): TenantState {
  return {
    tenant,
    directory,
    conversations: {},
    createdAt: {},
    messages: {},
    reads: {},
    logins: {},
    seq: 0,
  };
}

/** Cria a direta (pelo mesmo `directConversation` do domínio) e as mensagens iniciais, já entregues. */
function seedDirect(ts: TenantState, a: StaffUser, b: StaffUser, now: number, lines: readonly SeedLine[]): void {
  const built = directConversation(a, b);
  if (!built.ok) {
    throw new Error(`seed inválida: ${a.id} ↔ ${b.id}`);
  }
  const conversation = built.value;
  ts.conversations[conversation.id] = conversation;
  const first = lines[0];
  ts.createdAt[conversation.id] = new Date(now - (first?.minutesAgo ?? 0) * 60_000).toISOString();
  const messages: ChatMessage[] = lines.map((line) => {
    ts.seq += 1;
    const message: TextMessage = {
      id: `msg:${ts.tenant.id}:${String(ts.seq)}`,
      tenantId: ts.tenant.id,
      conversationId: conversation.id,
      authorId: line.from.id,
      author: { id: line.from.id, name: line.from.name },
      timestamp: new Date(now - line.minutesAgo * 60_000).toISOString(),
      status: 'delivered',
      type: 'text',
      text: line.text,
    };
    return message;
  });
  ts.messages[conversation.id] = messages;
}

function must(directory: Directory, id: UserId): StaffUser {
  const found = directory.users[id];
  if (!found) {
    throw new Error(`seed inválida: usuário ${id}`);
  }
  return found;
}

/** Estado inicial das duas empresas. Sem aviso/PDF (Etapa 8). */
export function createSeedState(nowIso: string): ServerState {
  const now = Date.parse(nowIso);
  const ics = emptyTenant(ICS_TENANT, icsDirectory());
  const d = ics.directory;
  const carla = must(d, ICS_USERS.carla);
  const rafael = must(d, ICS_USERS.rafael);
  const marcos = must(d, ICS_USERS.marcos);
  const ana = must(d, ICS_USERS.ana);
  const bruno = must(d, ICS_USERS.bruno);
  const camila = must(d, ICS_USERS.camila);
  const elisa = must(d, ICS_USERS.elisa);
  seedDirect(ics, carla, ana, now, [
    { from: carla, text: 'Bom dia, Ana! Como está a fila do Norte hoje?', minutesAgo: 95 },
    { from: ana, text: 'Bom dia! Tranquila, só dois retornos pendentes.', minutesAgo: 90 },
    { from: carla, text: 'Ótimo. Qualquer coisa me avisa.', minutesAgo: 88 },
  ]);
  seedDirect(ics, ana, bruno, now, [
    { from: ana, text: 'Bruno, você cobre meu horário de almoço?', minutesAgo: 60 },
    { from: bruno, text: 'Cubro sim, pode ir.', minutesAgo: 58 },
  ]);
  seedDirect(ics, carla, marcos, now, [
    { from: marcos, text: 'Carla, me manda o resumo do mês quando puder.', minutesAgo: 300 },
  ]);
  seedDirect(ics, rafael, elisa, now, [
    { from: elisa, text: 'Rafael, o laudo do paciente da manhã já saiu?', minutesAgo: 45 },
    { from: rafael, text: 'Saiu. Conferi agora há pouco.', minutesAgo: 40 },
  ]);
  seedDirect(ics, carla, bruno, now, []);
  seedDirect(ics, carla, camila, now, []);

  const bv = emptyTenant(BV_TENANT, bvDirectory());
  const paula = must(bv.directory, BV_USERS.paula);
  const rui = must(bv.directory, BV_USERS.rui);
  const otavio = must(bv.directory, BV_USERS.otavio);
  seedDirect(bv, otavio, paula, now, [
    { from: otavio, text: 'Paula, confirma a agenda de amanhã, por favor.', minutesAgo: 70 },
    { from: paula, text: 'Confirmada.', minutesAgo: 66 },
  ]);
  seedDirect(bv, paula, rui, now, [{ from: rui, text: 'Posso ficar com o retorno das 15h.', minutesAgo: 30 }]);

  return new Map([
    [ics.tenant.id, ics],
    [bv.tenant.id, bv],
  ]);
}
