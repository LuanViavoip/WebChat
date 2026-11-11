import {
  liveActivity,
  liveActivityAnnouncement,
  liveActivityLabel,
  type LiveActivityInput,
} from './liveActivity';

const idle: LiveActivityInput = {
  messages: [],
  connection: 'connected',
  typing: { isTyping: false },
  error: null,
};

describe('liveActivity', () => {
  it('prioriza erro sobre os demais estados', () => {
    expect(
      liveActivity({
        ...idle,
        error: 'Falha ao conectar',
        connection: 'connecting',
        typing: { isTyping: true },
        messages: [{ status: 'sending' }],
      }),
    ).toBe('error');
  });

  it('indica reconexão, envio e digitação', () => {
    expect(liveActivity({ ...idle, connection: 'connecting' })).toBe('connecting');
    expect(liveActivity({ ...idle, connection: 'connecting', hadConnected: true })).toBe('reconnecting');
    expect(liveActivity({ ...idle, messages: [{ status: 'sending' }] })).toBe('sending');
    expect(liveActivity({ ...idle, typing: { isTyping: true } })).toBe('typing');
    expect(liveActivity(idle)).toBe('idle');
  });

  it('marca mensagem não vista só depois dos estados transitórios', () => {
    expect(liveActivity({ ...idle, unseen: true, typing: { isTyping: true } })).toBe('typing');
    expect(liveActivity({ ...idle, unseen: true })).toBe('unseen');
  });
});

describe('liveActivityLabel', () => {
  it('rotula cada estado de forma acessível', () => {
    expect(liveActivityLabel('error')).toBe('Erro');
    expect(liveActivityLabel('connecting')).toBe('Conectando');
    expect(liveActivityLabel('reconnecting')).toBe('Reconectando');
    expect(liveActivityLabel('sending')).toBe('Enviando…');
    expect(liveActivityLabel('typing')).toBe('Digitando…');
    expect(liveActivityLabel('unseen')).toBe('Nova mensagem');
    expect(liveActivityLabel('idle')).toBe('');
  });
});

describe('liveActivityAnnouncement', () => {
  it('não anuncia erro quando o banner da conversa ao vivo já alerta', () => {
    expect(liveActivityAnnouncement('error', true)).toBe('');
    expect(liveActivityAnnouncement('error', false)).toBe('Erro');
  });

  it('com o chat ao vivo aberto não anuncia envio, digitação nem conexão inicial', () => {
    expect(liveActivityAnnouncement('sending', true)).toBe('');
    expect(liveActivityAnnouncement('typing', true)).toBe('');
    expect(liveActivityAnnouncement('connecting', true)).toBe('');
    expect(liveActivityAnnouncement('reconnecting', true)).toBe('');
    expect(liveActivityAnnouncement('unseen', true)).toBe('');
    expect(liveActivityAnnouncement('idle', true)).toBe('');
  });

  it('com o histórico aberto anuncia só erro, reconexão e nova mensagem', () => {
    expect(liveActivityAnnouncement('unseen', false)).toBe('Nova mensagem');
    expect(liveActivityAnnouncement('reconnecting', false)).toBe('Reconectando');
    expect(liveActivityAnnouncement('error', false)).toBe('Erro');
    expect(liveActivityAnnouncement('sending', false)).toBe('');
    expect(liveActivityAnnouncement('typing', false)).toBe('');
    expect(liveActivityAnnouncement('connecting', false)).toBe('');
    expect(liveActivityAnnouncement('idle', false)).toBe('');
  });
});
