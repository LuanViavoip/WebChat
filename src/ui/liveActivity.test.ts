import { liveActivity, liveActivityLabel, type LiveActivityInput } from './liveActivity';

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
    expect(liveActivity({ ...idle, messages: [{ status: 'sending' }] })).toBe('sending');
    expect(liveActivity({ ...idle, typing: { isTyping: true } })).toBe('typing');
    expect(liveActivity(idle)).toBe('idle');
  });
});

describe('liveActivityLabel', () => {
  it('rotula cada estado de forma acessível', () => {
    expect(liveActivityLabel('error')).toBe('Erro');
    expect(liveActivityLabel('connecting')).toBe('Reconectando');
    expect(liveActivityLabel('sending')).toBe('Enviando…');
    expect(liveActivityLabel('typing')).toBe('Digitando…');
    expect(liveActivityLabel('idle')).toBe('');
  });
});
