export type ConversationPreview = {
  id: string;
  title: string;
  preview: string;
  timeLabel: string;
  active: boolean;
  available: boolean;
  unread: number;
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
  },
  {
    id: 'ics-anterior',
    title: 'Atendimento anterior',
    preview: 'Encerrado — histórico quando o SM conectar',
    timeLabel: '3 nov',
    active: false,
    available: false,
    unread: 0,
  },
  {
    id: 'ics-exames',
    title: 'Exames e vacinas',
    preview: 'Fila futura do canal WhatsApp do SM',
    timeLabel: 'ontem',
    active: false,
    available: false,
    unread: 1,
  },
];
