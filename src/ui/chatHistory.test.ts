import { historyConversationId, historyPane, mergeHistoryState } from './chatHistory';

describe('mergeHistoryState', () => {
  it('preserva campos já existentes e grava o id da conversa', () => {
    const merged = mergeHistoryState({ smPane: 'chat', host: 'portal' }, { conversationId: 'ics-anterior' });
    expect(merged).toEqual({
      smPane: 'chat',
      host: 'portal',
      conversationId: 'ics-anterior',
    });
  });

  it('aceita estado nulo ou não-objeto', () => {
    expect(mergeHistoryState(null, { smPane: 'list', conversationId: 'ics-atual' })).toEqual({
      smPane: 'list',
      conversationId: 'ics-atual',
    });
    expect(mergeHistoryState('lixo', { smPane: 'chat' })).toEqual({ smPane: 'chat' });
  });
});

describe('leitura do history.state', () => {
  it('lê o painel e o id da conversa', () => {
    expect(historyPane({ smPane: 'chat', conversationId: 'ics-exames' })).toBe('chat');
    expect(historyConversationId({ smPane: 'chat', conversationId: 'ics-exames' })).toBe('ics-exames');
  });

  it('cai na lista quando o estado não traz painel', () => {
    expect(historyPane(null)).toBe('list');
    expect(historyConversationId({})).toBeUndefined();
  });
});
