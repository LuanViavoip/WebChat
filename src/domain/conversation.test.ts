import { makeUser, seedDirectory, T1, T2, user } from '../test/domainFixtures';
import {
  asConversationId,
  conversationTier,
  directConversation,
  directConversationId,
  sortConversations,
  type Conversation,
  type ConversationSummary,
  type GroupConversation,
} from './conversation';
import type { StaffUser } from './identity';

const d = seedDirectory();
const admin = user(d, 'admin');
const sup1 = user(d, 'sup-1');
const sup2 = user(d, 'sup-2');
const ag1 = user(d, 'ag-1'); // ilha-1 (sup-1)
const ag2 = user(d, 'ag-2'); // ilha-1
const ag3 = user(d, 'ag-3'); // ilha-2 (sup-2)

function dm(a: StaffUser, b: StaffUser): Conversation {
  const result = directConversation(a, b);
  if (!result.ok) throw new Error(result.error);
  return result.value;
}

const grupo: GroupConversation = {
  kind: 'group',
  id: asConversationId('grp:1'),
  tenantId: T1,
  title: 'Plantão',
  createdBy: sup1.id,
  members: [sup1.id, ag1.id],
  ilhaId: null,
  createdAt: '2026-11-10T12:00:00.000Z',
};

describe('directConversation', () => {
  it('com o mesmo usuário: same-user', () => {
    expect(directConversation(ag1, ag1)).toEqual({ ok: false, error: 'same-user' });
  });

  it('(a, b) e (b, a) geram a mesma conversa e o mesmo id', () => {
    const ab = directConversation(ag1, ag2);
    const ba = directConversation(ag2, ag1);
    expect(ab).toEqual(ba);
    expect(ab.ok && ab.value.id).toBe(`dm:${T1}:ag-1:ag-2`);
    expect(ab.ok && ab.value.participants).toEqual(['ag-1', 'ag-2']);
    expect(ab.ok && ab.value.tenantId).toBe(T1);
  });

  it('tenants diferentes: cross-tenant (nas duas ordens)', () => {
    const outro = makeUser('agent', 'outro-b', { tenantId: T2 });
    expect(directConversation(ag1, outro)).toEqual({ ok: false, error: 'cross-tenant' });
    expect(directConversation(outro, ag2)).toEqual({ ok: false, error: 'cross-tenant' });
  });

  it('o tenant vem antes de same-user: mesmo id em tenants diferentes é cross-tenant', () => {
    expect(directConversation(ag1, { ...ag1, tenantId: T2 })).toEqual({ ok: false, error: 'cross-tenant' });
    expect(directConversation({ ...ag1, tenantId: T2 }, ag1)).toEqual({ ok: false, error: 'cross-tenant' });
  });

  it('directConversationId é simétrico', () => {
    expect(directConversationId(T1, ag1.id, ag2.id)).toBe(directConversationId(T1, ag2.id, ag1.id));
  });
});

describe('conversationTier', () => {
  it('grupo é sempre priority', () => {
    for (const me of [ag1, sup1, admin]) {
      expect(conversationTier(grupo, me, d)).toBe('priority');
    }
  });

  it('agente: a direta com o supervisor da ilha é priority; com colega, colleagues', () => {
    expect(conversationTier(dm(ag1, sup1), ag1, d)).toBe('priority');
    expect(conversationTier(dm(ag1, ag2), ag1, d)).toBe('colleagues');
  });

  it('agente: supervisor de OUTRA ilha, admin e agente de outra ilha são colegas', () => {
    expect(conversationTier(dm(ag1, sup2), ag1, d)).toBe('colleagues');
    expect(conversationTier(dm(ag1, admin), ag1, d)).toBe('colleagues');
    expect(conversationTier(dm(ag1, ag3), ag1, d)).toBe('colleagues');
  });

  it('supervisor: a direta com agente da ilha dele é priority; de outra ilha, não', () => {
    expect(conversationTier(dm(sup1, ag1), sup1, d)).toBe('priority');
    expect(conversationTier(dm(sup1, ag2), sup1, d)).toBe('priority');
    expect(conversationTier(dm(sup1, ag3), sup1, d)).toBe('colleagues');
  });

  it('supervisor: com outro supervisor ou com o admin é colleagues', () => {
    expect(conversationTier(dm(sup1, sup2), sup1, d)).toBe('colleagues');
    expect(conversationTier(dm(sup1, admin), sup1, d)).toBe('colleagues');
  });

  it('admin: diretas com supervisores são priority (decisão); com agentes, colleagues', () => {
    expect(conversationTier(dm(admin, sup1), admin, d)).toBe('priority');
    expect(conversationTier(dm(admin, ag1), admin, d)).toBe('colleagues');
  });

  it('conversa de outro tenant fica em colleagues (grupo ou direta)', () => {
    expect(conversationTier({ ...grupo, tenantId: T2 }, ag1, d)).toBe('colleagues');
    const base = dm(ag1, sup1);
    expect(conversationTier({ ...base, tenantId: T2 }, ag1, d)).toBe('colleagues');
  });

  it('quem não participa da direta fica em colleagues', () => {
    expect(conversationTier(dm(ag2, sup1), ag1, d)).toBe('colleagues');
  });
});

describe('sortConversations', () => {
  function summary(conversation: Conversation, lastActivityAt: string, unread = 0): ConversationSummary {
    return { id: conversation.id, conversation, lastActivityAt, unread };
  }

  it('separa em priority e colleagues e ordena cada seção por última atividade desc', () => {
    const items = [
      summary(dm(ag1, ag2), '2026-11-10T10:00:00.000Z'),
      summary(dm(ag1, sup1), '2026-11-10T09:00:00.000Z'),
      summary(dm(ag1, ag3), '2026-11-10T12:00:00.000Z', 2),
      summary(grupo, '2026-11-10T11:00:00.000Z'),
      summary(dm(ag1, admin), '2026-11-10T08:00:00.000Z'),
    ];
    const { priority, colleagues } = sortConversations(items, ag1, d);
    expect(priority.map((item) => item.id)).toEqual([grupo.id, dm(ag1, sup1).id]);
    expect(colleagues.map((item) => item.id)).toEqual([dm(ag1, ag3).id, dm(ag1, ag2).id, dm(ag1, admin).id]);
  });

  it('priority fica separada mesmo quando um colega é mais recente', () => {
    const { priority, colleagues } = sortConversations(
      [summary(dm(ag1, ag2), '2026-11-11T00:00:00.000Z'), summary(dm(ag1, sup1), '2026-01-01T00:00:00.000Z')],
      ag1,
      d,
    );
    expect(priority).toHaveLength(1);
    expect(colleagues).toHaveLength(1);
  });

  it('não muta a entrada e desempata por id', () => {
    const items = [
      summary(dm(ag1, ag3), '2026-11-10T10:00:00.000Z'),
      summary(dm(ag1, ag2), '2026-11-10T10:00:00.000Z'),
    ];
    const copy = [...items];
    const { colleagues } = sortConversations(items, ag1, d);
    expect(items).toEqual(copy);
    expect(colleagues.map((item) => item.id)).toEqual([dm(ag1, ag2).id, dm(ag1, ag3).id]);
  });

  it('para o supervisor, diretas com agentes das ilhas dele ficam em priority', () => {
    const { priority, colleagues } = sortConversations(
      [summary(dm(sup1, ag1), '2026-11-10T10:00:00.000Z'), summary(dm(sup1, ag3), '2026-11-10T11:00:00.000Z')],
      sup1,
      d,
    );
    expect(priority.map((item) => item.id)).toEqual([dm(sup1, ag1).id]);
    expect(colleagues.map((item) => item.id)).toEqual([dm(sup1, ag3).id]);
  });
});
