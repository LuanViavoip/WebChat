export type ConversationPreview = {
  id: string;
  title: string;
  preview: string;
  timeLabel: string;
  active: boolean;
  available: boolean;
  unread: number;
  demo: boolean;
};

export const CLIENT_CONVERSATIONS: ConversationPreview[] = [
  {
    id: 'ics-atual',
    title: 'ICS Pré-atendimento',
    preview: 'Canal web do paciente com o ICS',
    timeLabel: 'hoje',
    active: true,
    available: true,
    unread: 0,
    demo: false,
  },
  {
    id: 'ics-anterior',
    title: 'Atendimento anterior',
    preview: 'Encerrado — histórico quando o SM conectar',
    timeLabel: '3 nov',
    active: false,
    available: false,
    unread: 0,
    demo: true,
  },
  {
    id: 'ics-exames',
    title: 'Exames e vacinas',
    preview: 'Fila futura do canal WhatsApp do SM',
    timeLabel: 'ontem',
    active: false,
    available: false,
    unread: 0,
    demo: true,
  },
];

export function filterConversations(
  items: ConversationPreview[],
  query: string,
  filter: 'all' | 'unread',
  activePreview: string,
): ConversationPreview[] {
  const needle = query.trim().toLowerCase();
  return items.filter((item) => {
    if (filter === 'unread' && (item.demo || item.unread === 0)) {
      return false;
    }
    if (!needle) {
      return true;
    }
    const preview = item.active ? activePreview : item.preview;
    const demoLabel = item.demo ? 'demonstração' : '';
    return `${item.title} ${preview} ${demoLabel}`.toLowerCase().includes(needle);
  });
}
