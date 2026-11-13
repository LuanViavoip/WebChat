import { historyConversationId, historyPane, mergeHistoryState } from './chatHistory';

describe('mergeHistoryState', () => {
  it('preserva campos já existentes e grava o id da conversa', () => {
    const merged = mergeHistoryState({ smPane: 'chat', host: 'portal' }, { conversationId: 'conv-a' });
    expect(merged).toEqual({
      smPane: 'chat',
      host: 'portal',
      conversationId: 'conv-a',
    });
  });

  it('aceita estado nulo ou não-objeto', () => {
    expect(mergeHistoryState(null, { smPane: 'list', conversationId: 'conversa-teste' })).toEqual({
      smPane: 'list',
      conversationId: 'conversa-teste',
    });
    expect(mergeHistoryState('lixo', { smPane: 'chat' })).toEqual({ smPane: 'chat' });
  });
});

describe('leitura do history.state', () => {
  it('lê o painel e o id da conversa', () => {
    expect(historyPane({ smPane: 'chat', conversationId: 'conv-b' })).toBe('chat');
    expect(historyConversationId({ smPane: 'chat', conversationId: 'conv-b' })).toBe('conv-b');
  });

  it('cai na lista quando o estado não traz painel', () => {
    expect(historyPane(null)).toBe('list');
    expect(historyConversationId({})).toBeUndefined();
  });
});
