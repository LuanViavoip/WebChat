import { ROLE_CEILING } from '@viavoip/internal-domain';
import { directConversationId } from '@viavoip/internal-domain';
import { MockBackend } from './MockBackend';
import { MemoryMockStore } from './MockStore';
import { MockTransport } from './MockTransport';
import { BV_TENANT_ID, BV_USERS, createSeedState, ICS_TENANT_ID, ICS_USERS, DEFAULT_SESSION, LIVE_CONVERSATION_ID } from './seed';
import { fromPersisted, toPersisted, type PersistedState } from './state';

 
type Json = Record<string, any>;

const fresh = (): PersistedState => toPersisted(createSeedState('2026-11-13T12:00:00.000Z'));
const ics = (state: PersistedState): Json => (state.tenants as unknown as Json[]).find((t) => t.tenant.id === ICS_TENANT_ID) as Json;
const bv = (state: PersistedState): Json => (state.tenants as unknown as Json[]).find((t) => t.tenant.id === BV_TENANT_ID) as Json;

const ANA_CARLA = directConversationId(ICS_TENANT_ID, ICS_USERS.ana, ICS_USERS.carla);

const tampering: Array<[string, (state: PersistedState) => void]> = [
  [
    'conversa e mensagens de BV dentro da partição ICS',
    (state) => {
      const foreign = bv(state);
      Object.assign(ics(state).conversations, foreign.conversations);
      Object.assign(ics(state).messages, foreign.messages);
      Object.assign(ics(state).createdAt, foreign.createdAt);
    },
  ],
  [
    'admin rebaixado a supervisor (empresa sem administrador), com grants ajustados ao teto',
    (state) => {
      const marcos = ics(state).directory.users[ICS_USERS.marcos];
      marcos.role = 'supervisor';
      marcos.grants = [...ROLE_CEILING.supervisor];
    },
  ],
  ['único admin inativo', (s) => { ics(s).directory.users[ICS_USERS.marcos].active = false; }],
  ['conversa com tenantId de outro tenant', (s) => { ics(s).conversations[ANA_CARLA].tenantId = BV_TENANT_ID; }],
  ['chave da conversa diferente do id', (s) => { ics(s).conversations[ANA_CARLA].id = 'dm:ics:outro'; }],
  ['direta com participantes repetidos', (s) => { ics(s).conversations[ANA_CARLA].participants = [ICS_USERS.ana, ICS_USERS.ana]; }],
  ['direta com 3 participantes', (s) => { ics(s).conversations[ANA_CARLA].participants = [ICS_USERS.ana, ICS_USERS.carla, ICS_USERS.bruno]; }],
  ['direta com participante de outro tenant', (s) => { ics(s).conversations[ANA_CARLA].participants = [ICS_USERS.ana, BV_USERS.paula]; }],
  ['direta com participante inexistente', (s) => { ics(s).conversations[ANA_CARLA].participants = [ICS_USERS.ana, 'fantasma']; }],
  ['mensagem com tenantId de outro tenant', (s) => { ics(s).messages[ANA_CARLA][0].tenantId = BV_TENANT_ID; }],
  ['mensagem com conversationId diferente da chave', (s) => { ics(s).messages[ANA_CARLA][0].conversationId = LIVE_CONVERSATION_ID; }],
  ['mensagem com autor de outro tenant', (s) => { ics(s).messages[ANA_CARLA][0].authorId = BV_USERS.paula; }],
  ['mensagem com autor que não participa da conversa', (s) => { ics(s).messages[ANA_CARLA][0].authorId = ICS_USERS.diego; }],
  ['mensagem com id repetido', (s) => { ics(s).messages[ANA_CARLA][1].id = ics(s).messages[ANA_CARLA][0].id; }],
  ['leitura de usuário que não participa', (s) => { ics(s).reads[ANA_CARLA] = { [ICS_USERS.diego]: ics(s).messages[ANA_CARLA][0].id }; }],
  ['leitura de mensagem inexistente', (s) => { ics(s).reads[ANA_CARLA] = { [ICS_USERS.ana]: 'msg:inexistente' }; }],
  ['login de usuário desconhecido', (s) => { ics(s).logins = { fantasma: { userId: 'fantasma', lastLoginDate: null } }; }],
  ['login com userId diferente da chave', (s) => { ics(s).logins = { [ICS_USERS.ana]: { userId: ICS_USERS.carla, lastLoginDate: null } }; }],
  ['ilha de outro tenant', (s) => { ics(s).directory.ilhas['ics-norte'].tenantId = BV_TENANT_ID; }],
  ['ilha com supervisor inexistente', (s) => { ics(s).directory.ilhas['ics-norte'].supervisorId = 'fantasma'; }],
  ['usuário com chave diferente do id', (s) => { ics(s).directory.users[ICS_USERS.ana].id = ICS_USERS.bruno; }],
  ['usuário com tenantId de outro tenant', (s) => { ics(s).directory.users[ICS_USERS.ana].tenantId = BV_TENANT_ID; }],
  ['mensagens de conversa que não existe', (s) => { ics(s).messages['dm:ics:nada'] = []; }],
];

describe('fromPersisted valida tudo que o storage afirma', () => {
  it('a seed íntegra passa', () => {
    expect(fromPersisted(fresh())).toBeDefined();
  });

  it.each(tampering)('descarta: %s', (_name, tamper) => {
    const state = fresh();
    tamper(state);
    expect(fromPersisted(JSON.parse(JSON.stringify(state)))).toBeUndefined();
  });

  it('storage adulterado com dados de BV na partição ICS: o backend recria a seed e o Bootstrap não tem ids de BV', async () => {
    const state = fresh();
    Object.assign(ics(state).conversations, bv(state).conversations);
    Object.assign(ics(state).messages, bv(state).messages);
    Object.assign(ics(state).createdAt, bv(state).createdAt);
    const store = new MemoryMockStore();
    store.save(state);
    const backend = new MockBackend({ store });
    const transport = new MockTransport({ delays: { connectMs: 0 }, backend });
    const bootstrap = await transport.connect(DEFAULT_SESSION);
    const json = JSON.stringify(bootstrap, (_k, v: unknown) => (v instanceof Set ? [...(v as Set<string>)] : v));
    for (const id of [BV_TENANT_ID, ...Object.keys(bv(state).directory.users as Json), ...Object.keys(bv(state).conversations as Json)]) {
      expect(json).not.toContain(`"${id}"`);
    }
    expect(ics(toPersisted(backend.server.getState())).conversations).not.toHaveProperty('dm:bv:bv-otavio:bv-paula');
  });
});
