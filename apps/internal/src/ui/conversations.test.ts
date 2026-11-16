import { asConversationId, directConversation, type ConversationSummary } from '../domain/conversation';
import { makeDirectory, makeIlha, makeUser, seedDirectory, T1, user } from '../test/domainFixtures';
import {
  conversationItem,
  conversationTimeLabel,
  conversationTitle,
  emptyConversationCopy,
  filterConversations,
  openableColleagues,
  otherParticipant,
  roleLabel,
  type ConversationItem,
} from './conversations';

const directory = seedDirectory();
const me = user(directory, 'sup-1');
const ag1 = user(directory, 'ag-1');

function summary(other: typeof ag1, over: Partial<ConversationSummary> = {}): ConversationSummary {
  const built = directConversation(me, other);
  if (!built.ok) {
    throw new Error('fixture inválida');
  }
  return { id: built.value.id, conversation: built.value, lastActivityAt: '2026-11-10T11:00:00.000Z', unread: 0, ...over };
}

function item(over: Partial<ConversationItem> = {}): ConversationItem {
  return {
    id: asConversationId('c1'),
    title: 'Ana',
    preview: 'oi',
    timeLabel: '',
    timeIso: '2026-11-10T11:00:00.000Z',
    unread: 0,
    activity: 'idle',
    ...over,
  };
}

describe('roleLabel', () => {
  it('traduz as roles para a UI', () => {
    expect(roleLabel('admin')).toBe('Administrador');
    expect(roleLabel('supervisor')).toBe('Supervisor(a)');
    expect(roleLabel('agent')).toBe('Agente');
  });
});

describe('título e outro participante', () => {
  it('o título de uma direta é o nome do outro lado, para os dois lados', () => {
    const { conversation } = summary(ag1);
    expect(conversationTitle(conversation, me, directory)).toBe('ag-1');
    expect(conversationTitle(conversation, ag1, directory)).toBe('sup-1');
    expect(otherParticipant(conversation, me, directory)?.id).toBe(ag1.id);
  });
});

describe('conversationItem', () => {
  it('conversa sem mensagem: prévia padrão e sem horário', () => {
    const built = conversationItem(summary(ag1), me, directory, 'idle');
    expect(built.preview).toBe('Nenhuma mensagem ainda');
    expect(built.timeLabel).toBe('');
  });

  it('com mensagem: prévia, não lidas e horário', () => {
    const built = conversationItem(summary(ag1, { preview: 'Bom dia', unread: 2 }), me, directory, 'idle');
    expect(built.preview).toBe('Bom dia');
    expect(built.unread).toBe(2);
    expect(built.timeLabel).not.toBe('');
  });
});

describe('conversationTimeLabel', () => {
  const now = new Date(2026, 10, 12, 15, 0);
  it('hoje mostra a hora, ontem diz Ontem e antes mostra a data', () => {
    expect(conversationTimeLabel(new Date(2026, 10, 12, 9, 5).toISOString(), now)).toMatch(/09:05/);
    expect(conversationTimeLabel(new Date(2026, 10, 11, 23, 0).toISOString(), now)).toBe('Ontem');
    expect(conversationTimeLabel(new Date(2026, 9, 1, 8, 0).toISOString(), now)).toMatch(/01\/10\/2026/);
  });
});

describe('filterConversations', () => {
  const read = item({ id: asConversationId('a'), title: 'Ana', preview: 'bom dia' });
  const unread = item({ id: asConversationId('b'), title: 'Bruno', preview: 'almoço', unread: 3 });
  const broken = item({ id: asConversationId('c'), title: 'Carla', preview: 'x', activity: 'error' });

  it('o filtro Não lidas deixa só as com não lidas', () => {
    expect(filterConversations([read, unread], '', 'unread').map((i) => i.title)).toEqual(['Bruno']);
    expect(filterConversations([read], '', 'unread')).toEqual([]);
  });

  it('busca por título e por prévia, sem diferenciar maiúsculas', () => {
    expect(filterConversations([read, unread], 'ANA', 'all').map((i) => i.title)).toEqual(['Ana']);
    expect(filterConversations([read, unread], 'almoço', 'all').map((i) => i.title)).toEqual(['Bruno']);
  });

  it('a conversa com erro continua à vista mesmo sem casar com a busca', () => {
    expect(filterConversations([read, broken], 'zzzz', 'all').map((i) => i.title)).toEqual(['Carla']);
  });
});

describe('emptyConversationCopy', () => {
  it('usa Nenhum resultado encontrado quando a busca não acha nada', () => {
    expect(emptyConversationCopy('all', 'xyz')).toBe('Nenhum resultado encontrado');
    expect(emptyConversationCopy('unread', 'xyz')).toBe('Nenhum resultado encontrado');
  });

  it('usa Nenhuma conversa não lida só no filtro Não lidas sem busca', () => {
    expect(emptyConversationCopy('unread', '')).toBe('Nenhuma conversa não lida');
    expect(emptyConversationCopy('unread', '   ')).toBe('Nenhuma conversa não lida');
    expect(emptyConversationCopy('all', '')).toBe('Nenhuma conversa');
  });
});

describe('openableColleagues', () => {
  it('lista quem a mesma can(direct.open) deixa abrir: sem o próprio usuário, sem inativo e sem quem não tem chat.use', () => {
    const d = makeDirectory(
      T1,
      [
        makeUser('supervisor', 'sup', { name: 'Sup' }),
        makeUser('agent', 'a-ok', { name: 'Ok' }),
        makeUser('agent', 'a-off', { name: 'Inativo', active: false }),
        makeUser('agent', 'a-mudo', { name: 'SemChat', grants: [] }),
        makeUser('agent', 'a-b', { name: 'Outro agente' }),
      ],
      [makeIlha('ilha-1', 'sup')],
    );
    const names = openableColleagues(user(d, 'sup'), d).map((u) => u.name);
    expect(names).toEqual(['Ok', 'Outro agente']);
    // agente ↔ agente da mesma empresa é permitido
    expect(openableColleagues(user(d, 'a-ok'), d).map((u) => u.name)).toEqual(['Sup', 'Outro agente']);
  });

  it('quem não tem chat.use não abre direta com ninguém', () => {
    const d = makeDirectory(
      T1,
      [makeUser('supervisor', 'sup'), makeUser('agent', 'a-mudo', { grants: [] })],
      [makeIlha('ilha-1', 'sup')],
    );
    expect(openableColleagues(user(d, 'a-mudo'), d)).toEqual([]);
  });
});
