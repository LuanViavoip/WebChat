import type { ChatMessage, MessageAuthor, MessageStatus, TextMessage } from '../domain/message';

export const LIVE_CONVERSATION_ID = 'ics-atual';

export type ConversationPreview = {
  id: string;
  title: string;
  preview: string;
  timeLabel: string;
  unread: number;
  transcript: ChatMessage[];
  demo: boolean;
};

const BOT: MessageAuthor = { id: 'bot-preatendimento', name: 'ICS Pré-atendimento' };
const APS: MessageAuthor = { id: 'agent-aps', name: 'Equipe APS' };
const CLIENT: MessageAuthor = { id: 'client', name: 'Você' };

function text(
  conversationId: string,
  id: string,
  direction: TextMessage['direction'],
  author: MessageAuthor,
  timestamp: string,
  body: string,
  status: MessageStatus = 'read',
): TextMessage {
  return {
    id,
    conversationId,
    direction,
    author,
    timestamp,
    status,
    type: 'text',
    text: body,
  };
}

const ANTERIOR_ID = 'ics-anterior';
const EXAMES_ID = 'ics-exames';

const ANTERIOR_TRANSCRIPT: ChatMessage[] = [
  text(
    ANTERIOR_ID,
    'ant-1',
    'bot',
    BOT,
    '2026-11-03T13:02:00.000Z',
    'Olá! Este canal registra o atendimento já encerrado com a equipe de APS.',
  ),
  text(
    ANTERIOR_ID,
    'ant-2',
    'client',
    CLIENT,
    '2026-11-03T13:03:12.000Z',
    'Preciso remarcar a consulta da clínica da família para outra manhã.',
  ),
  text(
    ANTERIOR_ID,
    'ant-3',
    'agent',
    APS,
    '2026-11-03T13:04:40.000Z',
    'Consigo ajudar. Qual unidade você costuma ir e tem preferência de dia?',
  ),
  text(
    ANTERIOR_ID,
    'ant-4',
    'client',
    CLIENT,
    '2026-11-03T13:05:18.000Z',
    'Unidade do bairro, de preferência terça de manhã.',
  ),
  text(
    ANTERIOR_ID,
    'ant-5',
    'agent',
    APS,
    '2026-11-03T13:07:05.000Z',
    'Encaminhei o pedido de remarcação. A confirmação chega neste canal quando a agenda responder.',
  ),
  text(
    ANTERIOR_ID,
    'ant-5b',
    'agent',
    APS,
    '2026-11-03T13:07:20.000Z',
    'Se a unidade não tiver vaga na terça, tentamos a quarta de manhã.',
  ),
  text(ANTERIOR_ID, 'ant-6', 'client', CLIENT, '2026-11-03T13:07:40.000Z', 'Obrigado!'),
  text(
    ANTERIOR_ID,
    'ant-7',
    'bot',
    BOT,
    '2026-11-03T13:08:10.000Z',
    'Atendimento encerrado. Para um novo assunto, use o ICS Pré-atendimento.',
  ),
];

const EXAMES_TRANSCRIPT: ChatMessage[] = [
  text(
    EXAMES_ID,
    'ex-1',
    'bot',
    BOT,
    '2026-11-10T10:12:00.000Z',
    'Olá! Aqui é o canal de exames e vacinas do ICS.',
  ),
  text(
    EXAMES_ID,
    'ex-2',
    'client',
    CLIENT,
    '2026-11-10T10:12:44.000Z',
    'Quero saber o horário da vacina da gripe.',
  ),
  text(
    EXAMES_ID,
    'ex-3',
    'bot',
    BOT,
    '2026-11-10T10:13:20.000Z',
    'A campanha de influenza está aberta. A vacinação ocorre nas unidades em horário comercial, sem agendamento.',
  ),
  text(
    EXAMES_ID,
    'ex-4',
    'client',
    CLIENT,
    '2026-11-10T10:14:02.000Z',
    'E o resultado do hemograma pedido na última consulta?',
  ),
  text(
    EXAMES_ID,
    'ex-5',
    'bot',
    BOT,
    '2026-11-10T10:14:48.000Z',
    'Resultados de laboratório ficam no portal do paciente em até 3 dias úteis após a coleta.',
  ),
  text(EXAMES_ID, 'ex-6', 'client', CLIENT, '2026-11-10T10:15:10.000Z', 'Entendi, obrigado.'),
  text(EXAMES_ID, 'ex-7', 'bot', BOT, '2026-11-10T10:15:40.000Z', 'Atendimento encerrado. Qualquer dúvida, inicie um novo contato.'),
];

export const CLIENT_CONVERSATIONS: ConversationPreview[] = [
  {
    id: LIVE_CONVERSATION_ID,
    title: 'ICS Pré-atendimento',
    preview: 'Canal web do paciente com o ICS',
    timeLabel: 'hoje',
    unread: 0,
    transcript: [],
    demo: false,
  },
  {
    id: ANTERIOR_ID,
    title: 'Atendimento anterior',
    preview: 'Encerrado — remarcação na clínica da família',
    timeLabel: '3 nov',
    unread: 0,
    transcript: ANTERIOR_TRANSCRIPT,
    demo: true,
  },
  {
    id: EXAMES_ID,
    title: 'Exames e vacinas',
    preview: 'Campanha de influenza e resultados de exames',
    timeLabel: 'ontem',
    unread: 0,
    transcript: EXAMES_TRANSCRIPT,
    demo: true,
  },
];

export function conversationItemLabel(
  item: ConversationPreview,
  extra?: string,
): string {
  const parts = [item.title];
  if (item.demo) {
    parts.push('Demonstração');
  }
  if (extra) {
    parts.push(extra);
  }
  return parts.join(', ');
}

export function isLiveConversation(id: string): boolean {
  return id === LIVE_CONVERSATION_ID;
}

export function conversationById(id: string): ConversationPreview {
  const found = CLIENT_CONVERSATIONS.find((item) => item.id === id);
  if (found) {
    return found;
  }
  const fallback = CLIENT_CONVERSATIONS[0];
  if (!fallback) {
    throw new Error('Nenhuma conversa configurada');
  }
  return fallback;
}

export function filterConversations(
  items: ConversationPreview[],
  query: string,
  filter: 'all' | 'unread',
  activePreview: string,
): ConversationPreview[] {
  const needle = query.trim().toLowerCase();
  return items.filter((item) => {
    if (filter === 'unread' && item.unread === 0) {
      return false;
    }
    if (!needle) {
      return true;
    }
    const preview = isLiveConversation(item.id) ? activePreview : item.preview;
    return `${item.title} ${preview}`.toLowerCase().includes(needle);
  });
}

export function emptyConversationCopy(filter: 'all' | 'unread', query: string): string {
  if (query.trim().length > 0) {
    return 'Nenhum resultado encontrado';
  }
  if (filter === 'unread') {
    return 'Nenhuma conversa não lida';
  }
  return 'Nenhum resultado encontrado';
}
