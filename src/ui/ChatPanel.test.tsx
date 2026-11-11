import { act, StrictMode } from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { TextMessage } from '../domain/message';
import { createFakeObjectUrls } from '../test/fakeObjectUrls';
import { stubDesktopMatchMedia, stubMobileMatchMedia } from '../test/matchMedia';
import { ScriptedTransport } from '../test/scriptedTransport';
import { MockTransport } from '../transport/MockTransport';
import { ChatPanel } from './ChatPanel';

const instant = {
  typingMs: 0,
  sentMs: 0,
  deliveredMs: 0,
  readMs: 0,
  replyMs: 0,
};

function thread() {
  return within(screen.getByRole('log', { name: 'Mensagens' }));
}

function fileInput(): HTMLInputElement {
  const input = document.querySelector('input[type="file"]');
  if (!(input instanceof HTMLInputElement)) {
    throw new Error('esperava input file');
  }
  return input;
}

function png(name = 'exame.png'): File {
  return new File([new Uint8Array(12)], name, { type: 'image/png' });
}

function isWellFormed(value: string): boolean {
  try {
    encodeURIComponent(value);
    return true;
  } catch {
    return false;
  }
}

const IMPLICIT_LIVE = '[role="log"], [role="status"], [role="alert"], [role="marquee"], [role="timer"]';

function liveRoles(): Array<string | null> {
  return liveRegions(document)
    .filter((node) => node.getAttribute('role'))
    .map((node) => node.getAttribute('role'));
}

function botText(conversationId: string, id: string, text: string): TextMessage {
  return {
    id,
    conversationId,
    direction: 'bot',
    author: { id: 'bot-preatendimento', name: 'ICS Pré-atendimento' },
    timestamp: new Date().toISOString(),
    status: 'delivered',
    type: 'text',
    text,
  };
}

function liveRegions(root: ParentNode): HTMLElement[] {
  const nodes = root.querySelectorAll(`[aria-live]:not([aria-live="off"]), ${IMPLICIT_LIVE}`);
  return [...nodes].filter((node): node is HTMLElement => {
    if (!(node instanceof HTMLElement)) {
      return false;
    }
    if (node.getAttribute('aria-live') === 'off') {
      return false;
    }
    return !node.parentElement?.closest(`[aria-live]:not([aria-live="off"]), ${IMPLICIT_LIVE}`);
  });
}

function activityBadge(): HTMLElement {
  const node = document.querySelector('.live-activity-badge');
  if (!(node instanceof HTMLElement)) {
    throw new Error('badge de atividade ausente');
  }
  return node;
}

function politeAnnouncements(): HTMLElement[] {
  return liveRegions(document).filter((node) => node.getAttribute('aria-live') === 'polite');
}

function activityAnnouncer(): HTMLElement {
  const node = document.querySelector('[data-live-announcer]');
  if (!(node instanceof HTMLElement)) {
    throw new Error('região aria-live de atividade ausente');
  }
  return node;
}

async function connectScripted(transport: ScriptedTransport, welcome = 'Olá, Carla Mendes!\nComo posso ajudar?') {
  await waitFor(() => {
    expect(transport.getStatus()).toBe('connected');
  });
  const conversationId = transport.lastSession?.conversationId ?? 'conv-web';
  act(() => {
    transport.emit({
      type: 'message',
      message: botText(conversationId, 'w1', welcome),
    });
  });
  await screen.findByText(/Como posso ajudar/);
  return conversationId;
}

describe('ChatPanel', () => {
  it('mostra boas-vindas pelo nome do paciente', async () => {
    render(<ChatPanel transport={new MockTransport({ delays: instant })} patientName="Carla Mendes" />);
    expect(await screen.findByText(/Como posso ajudar/)).toBeInTheDocument();
    expect(thread().getByText(/Carla Mendes/)).toBeInTheDocument();
  });

  it('mostra a lista de conversas do canal do cliente', async () => {
    render(<ChatPanel transport={new MockTransport({ delays: instant })} patientName="Carla Mendes" />);
    expect(await screen.findByLabelText('Lista de conversas')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /ICS Pré-atendimento/ })).toHaveAttribute('aria-current', 'true');
    expect(screen.getByRole('button', { name: /Atendimento anterior/ })).toBeEnabled();
    expect(screen.getByRole('button', { name: /Exames e vacinas/ })).toBeEnabled();
    expect(screen.getAllByText('Demonstração')).toHaveLength(2);
    expect(screen.getByRole('button', { name: /Atendimento anterior/ })).toHaveAccessibleName(/demonstração/i);
    expect(screen.getByRole('button', { name: /ICS Pré-atendimento/ })).not.toHaveAccessibleName(/demonstração/i);
  });

  it('abre o histórico somente leitura e preserva a sessão ao vivo', async () => {
    const user = userEvent.setup();
    const transport = new MockTransport({ delays: instant });
    const connect = vi.spyOn(transport, 'connect');
    render(<ChatPanel transport={transport} patientName="Carla Mendes" />);
    expect(await thread().findByText(/Como posso ajudar/)).toBeInTheDocument();
    expect(connect).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole('button', { name: /Atendimento anterior/ }));
    expect(screen.getByText('Atendimento encerrado · somente leitura')).toBeInTheDocument();
    expect(screen.getByText(/conversa fictícia para demonstração/i)).toBeInTheDocument();
    expect(screen.queryByLabelText('Mensagem')).not.toBeInTheDocument();
    expect(thread().getByText(/remarcar a consulta da clínica da família/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Atendimento anterior/ })).toHaveAttribute('aria-current', 'true');

    await user.click(screen.getByRole('button', { name: /ICS Pré-atendimento/ }));
    expect(thread().getByText(/Como posso ajudar/)).toBeInTheDocument();
    expect(screen.getByLabelText('Mensagem')).toBeInTheDocument();
    expect(connect).toHaveBeenCalledTimes(1);
  });

  it('abre conversa do histórico com Enter e volta com Espaço', async () => {
    const user = userEvent.setup();
    render(<ChatPanel transport={new MockTransport({ delays: instant })} patientName="Carla Mendes" />);
    await thread().findByText(/Como posso ajudar/);

    const historyItem = screen.getByRole('button', { name: /Atendimento anterior/ });
    historyItem.focus();
    expect(historyItem).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(thread().getByText(/remarcar a consulta da clínica da família/)).toBeInTheDocument();

    const liveItem = screen.getByRole('button', { name: /ICS Pré-atendimento/ });
    liveItem.focus();
    await user.keyboard(' ');
    expect(thread().getByText(/Como posso ajudar/)).toBeInTheDocument();
  });

  it('Tab alcança os itens da lista de conversas', async () => {
    const user = userEvent.setup();
    render(<ChatPanel transport={new MockTransport({ delays: instant })} patientName="Carla Mendes" />);
    await thread().findByText(/Como posso ajudar/);
    const historyItem = screen.getByRole('button', { name: /Atendimento anterior/ });
    for (let step = 0; step < 24 && document.activeElement !== historyItem; step += 1) {
      await user.tab();
    }
    expect(historyItem).toHaveFocus();
  });

  it('não mostra conversas de demonstração no filtro Não lidas', async () => {
    const user = userEvent.setup();
    render(<ChatPanel transport={new MockTransport({ delays: instant })} patientName="Carla Mendes" />);
    await screen.findByText(/Como posso ajudar/);
    await user.click(screen.getByRole('button', { name: 'Não lidas' }));
    expect(screen.queryByRole('button', { name: /Exames e vacinas/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Atendimento anterior/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /ICS Pré-atendimento/ })).not.toBeInTheDocument();
    expect(screen.getByText('Nenhuma conversa não lida')).toBeInTheDocument();
    expect(screen.queryByText('Nenhum resultado encontrado')).not.toBeInTheDocument();
  });

  it('mostra Nenhum resultado encontrado quando a busca no filtro Tudo não acha nada', async () => {
    const user = userEvent.setup();
    render(<ChatPanel transport={new MockTransport({ delays: instant })} patientName="Carla Mendes" />);
    await screen.findByText(/Como posso ajudar/);
    await user.type(screen.getByRole('searchbox', { name: 'Pesquisar conversa' }), 'zzzz-inexistente');
    expect(screen.getByText('Nenhum resultado encontrado')).toBeInTheDocument();
    expect(screen.queryByText('Nenhuma conversa não lida')).not.toBeInTheDocument();
  });

  it('mostra o foco visível no campo de busca da barra lateral', async () => {
    const user = userEvent.setup();
    render(<ChatPanel transport={new MockTransport({ delays: instant })} patientName="Carla Mendes" />);
    await screen.findByText(/Como posso ajudar/);
    const search = screen.getByRole('searchbox', { name: 'Pesquisar conversa' });
    const shell = search.closest('.sidebar-search');
    expect(shell).not.toBeNull();
    for (let step = 0; step < 12 && document.activeElement !== search; step += 1) {
      await user.tab();
    }
    expect(search).toHaveFocus();
    expect(shell?.matches(':focus-within')).toBe(true);
  });

  it('no modo compacto omite a lista e mantém o chat', async () => {
    render(
      <ChatPanel compact transport={new MockTransport({ delays: instant })} patientName="Carla Mendes" />,
    );
    expect(await screen.findByText(/Como posso ajudar/)).toBeInTheDocument();
    expect(screen.queryByLabelText('Lista de conversas')).not.toBeInTheDocument();
  });

  it('oferece as opções do pré-atendimento no balão da última mensagem do bot', async () => {
    render(<ChatPanel transport={new MockTransport({ delays: instant })} patientName="Carla Mendes" />);
    const welcome = await screen.findByLabelText(/Como posso ajudar/);
    expect(welcome).toHaveAccessibleName(/Carla Mendes/);
    expect(within(welcome).getByLabelText('Opções do atendimento')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Primeira vez/ })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Anexar arquivo' })).toBeEnabled();
  });

  it('sobrevive ao StrictMode sem duplicar o menu de boas-vindas', async () => {
    render(
      <StrictMode>
        <ChatPanel transport={new MockTransport({ delays: instant })} patientName="Carla Mendes" />
      </StrictMode>,
    );
    expect(await screen.findByText(/Como posso ajudar/)).toBeInTheDocument();
    expect(screen.getAllByText(/Como posso ajudar/)).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: /Primeira vez/ })).toHaveLength(1);
  });

  it('clicar no menu envia a opção e mostra a resposta do bot', async () => {
    const user = userEvent.setup();
    render(<ChatPanel transport={new MockTransport({ delays: instant })} patientName="Carla Mendes" />);
    await screen.findByText(/Como posso ajudar/);
    await user.click(screen.getByRole('button', { name: /Primeira vez/ }));
    await waitFor(() => {
      expect(thread().getByText(/Você escolheu Primeira vez/)).toBeInTheDocument();
    });
    expect(thread().getByText('1')).toBeInTheDocument();
  });

  it('atualiza o status da mensagem enviada até lida', async () => {
    const user = userEvent.setup();
    render(<ChatPanel transport={new MockTransport({ delays: instant })} patientName="Carla Mendes" />);
    await screen.findByText(/Como posso ajudar/);
    await user.type(screen.getByLabelText('Mensagem'), '2');
    await user.click(screen.getByRole('button', { name: 'Enviar' }));
    await waitFor(() => {
      expect(screen.getByLabelText('Lida')).toBeInTheDocument();
    });
  });

  it('encerra o atendimento, desativa o composer e permite reiniciar', async () => {
    const user = userEvent.setup();
    render(<ChatPanel transport={new MockTransport({ delays: instant })} patientName="Carla Mendes" />);
    await screen.findByText(/Como posso ajudar/);
    await user.click(screen.getByRole('button', { name: /Encerrar o Atendimento/ }));
    expect(await screen.findByText('Atendimento encerrado')).toBeInTheDocument();
    expect(screen.getByLabelText('Mensagem')).toBeDisabled();
    expect(screen.queryByRole('button', { name: /Primeira vez/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Iniciar novo atendimento' }));
    expect(await screen.findByText(/Como posso ajudar/)).toBeInTheDocument();
    expect(screen.getByLabelText('Mensagem')).toBeEnabled();
  });

  it('mostra erro de conexão e reconecta', async () => {
    const user = userEvent.setup();
    const transport = new MockTransport({ delays: instant, failConnect: true });
    render(<ChatPanel transport={transport} patientName="Carla Mendes" />);
    expect(await screen.findByRole('alert')).toHaveTextContent(/conectar/i);
    transport.failConnect = false;
    await user.click(screen.getByRole('button', { name: 'Reconectar' }));
    expect(await screen.findByText(/Como posso ajudar/)).toBeInTheDocument();
    expect(thread().getByText(/Carla Mendes/)).toBeInTheDocument();
  });

  it('falha de envio → Reconectar preserva texto e Reenviar', async () => {
    const user = userEvent.setup();
    const transport = new MockTransport({ delays: instant, failSend: true });
    render(<ChatPanel transport={transport} patientName="Carla Mendes" />);
    await screen.findByText(/Como posso ajudar/);
    await user.type(screen.getByLabelText('Mensagem'), 'preciso de ajuda');
    await user.click(screen.getByRole('button', { name: 'Enviar' }));
    expect(await screen.findByRole('button', { name: 'Reenviar mensagem' })).toBeInTheDocument();
    expect(thread().getByText('preciso de ajuda')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Reconectar' }));
    expect(thread().getByText('preciso de ajuda')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reenviar mensagem' })).toBeInTheDocument();
    expect(screen.getByText(/Como posso ajudar/)).toBeInTheDocument();
  });

  it('usa o log como única região viva no estado normal', async () => {
    render(<ChatPanel transport={new MockTransport({ delays: instant })} patientName="Carla Mendes" />);
    await screen.findByText(/Como posso ajudar/);
    expect(liveRoles()).toEqual(['log']);
    expect(activityAnnouncer()).toHaveTextContent('');
    expect(screen.getByRole('log', { name: 'Mensagens' })).not.toHaveAttribute('aria-live', 'off');
  });

  it('mantém a região aria-live montada vazia e só muda o texto no mesmo nó', async () => {
    const user = userEvent.setup();
    const transport = new ScriptedTransport();
    const view = render(<ChatPanel transport={transport} patientName="Carla Mendes" />);
    const announcer = activityAnnouncer();
    expect(announcer).toHaveAttribute('aria-live', 'polite');
    expect(announcer).toHaveTextContent('');
    const conversationId = await connectScripted(transport);
    expect(view.container.querySelector('[data-live-announcer]')).toBe(announcer);
    expect(announcer).toHaveTextContent('');

    await user.type(screen.getByLabelText('Mensagem'), '2');
    await user.click(screen.getByRole('button', { name: 'Enviar' }));
    const sent = transport.sent.at(-1);
    act(() => {
      if (sent) {
        transport.emit({
          type: 'status',
          messageId: sent.clientId,
          clientId: sent.clientId,
          status: 'read',
        });
      }
      transport.emit({
        type: 'message',
        message: botText(conversationId, 'reply-live', 'Você escolheu exames e resultados.'),
      });
    });
    expect(await thread().findByText(/Você escolheu exames/)).toBeInTheDocument();
    expect(view.container.querySelector('[data-live-announcer]')).toBe(announcer);
    expect(announcer).toHaveTextContent('');

    await user.click(screen.getByRole('button', { name: /Atendimento anterior/ }));
    act(() => {
      transport.emit({
        type: 'message',
        message: botText(conversationId, 'late-1', 'Sua escolha foi registrada.'),
      });
    });
    await waitFor(() => {
      expect(announcer).toHaveTextContent('Nova mensagem');
    });
    expect(view.container.querySelector('[data-live-announcer]')).toBe(announcer);
  });

  it('no erro de conexão o log permanece ativo e o banner é o único alerta', async () => {
    render(<ChatPanel transport={new MockTransport({ delays: instant, failConnect: true })} patientName="Carla Mendes" />);
    expect(await screen.findByRole('alert')).toHaveTextContent(/conectar/i);
    expect(liveRoles()).toEqual(['log', 'alert']);
    expect(screen.getByRole('log', { name: 'Mensagens' })).not.toHaveAttribute('aria-live', 'off');
  });

  it('no erro de envio o log permanece ativo junto do alerta', async () => {
    const user = userEvent.setup();
    const transport = new MockTransport({ delays: instant, failSend: true });
    render(<ChatPanel transport={transport} patientName="Carla Mendes" />);
    await screen.findByText(/Como posso ajudar/);
    await user.type(screen.getByLabelText('Mensagem'), 'oi');
    await user.click(screen.getByRole('button', { name: 'Enviar' }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(liveRoles()).toEqual(['log', 'alert']);
    expect(screen.getByRole('log', { name: 'Mensagens' })).not.toHaveAttribute('aria-live', 'off');
  });

  it('resposta após falha de envio entra no role=log ativo', async () => {
    const user = userEvent.setup();
    const transport = new ScriptedTransport();
    render(<ChatPanel transport={transport} patientName="Carla Mendes" />);
    await waitFor(() => {
      expect(transport.getStatus()).toBe('connected');
    });
    const conversationId = transport.lastSession?.conversationId ?? 'conv-web';
    act(() => {
      transport.emit({
        type: 'message',
        message: botText(conversationId, 'w1', 'Olá, Carla Mendes!\nComo posso ajudar?'),
      });
    });
    await screen.findByText(/Como posso ajudar/);
    transport.failSend = true;
    await user.type(screen.getByLabelText('Mensagem'), 'oi');
    await user.click(screen.getByRole('button', { name: 'Enviar' }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    const log = screen.getByRole('log', { name: 'Mensagens' });
    expect(log).not.toHaveAttribute('aria-live', 'off');
    act(() => {
      transport.emit({
        type: 'message',
        message: botText(conversationId, 'pending-reply', 'Resposta pendente chegou'),
      });
    });
    expect(within(log).getByText('Resposta pendente chegou')).toBeInTheDocument();
    expect(liveRoles()).toEqual(['log', 'alert']);
  });

  it('no encerramento só o log permanece vivo', async () => {
    const user = userEvent.setup();
    render(<ChatPanel transport={new MockTransport({ delays: instant })} patientName="Carla Mendes" />);
    await screen.findByText(/Como posso ajudar/);
    await user.click(screen.getByRole('button', { name: /Encerrar o Atendimento/ }));
    expect(await screen.findByText('Atendimento encerrado')).toBeInTheDocument();
    expect(liveRoles()).toEqual(['log']);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('mantém o texto em erro e permite reenviar', async () => {
    const user = userEvent.setup();
    const transport = new MockTransport({ delays: instant, failSend: true });
    render(<ChatPanel transport={transport} patientName="Carla Mendes" />);
    await screen.findByText(/Como posso ajudar/);
    await user.type(screen.getByLabelText('Mensagem'), 'preciso de ajuda');
    await user.click(screen.getByRole('button', { name: 'Enviar' }));
    expect(await screen.findByRole('button', { name: 'Reenviar mensagem' })).toBeInTheDocument();
    expect(thread().getByText('preciso de ajuda')).toBeInTheDocument();
    expect(screen.getByLabelText('Erro ao enviar')).toBeInTheDocument();
    transport.failSend = false;
    await user.click(screen.getByRole('button', { name: 'Reenviar mensagem' }));
    await waitFor(() => {
      expect(screen.getByLabelText('Lida')).toBeInTheDocument();
    });
    expect(thread().getByText('preciso de ajuda')).toBeInTheDocument();
  });

  it('preserva o rascunho ao trocar de conversa e voltar', async () => {
    const user = userEvent.setup();
    render(<ChatPanel transport={new MockTransport({ delays: instant })} patientName="Carla Mendes" />);
    await screen.findByText(/Como posso ajudar/);
    await user.type(screen.getByLabelText('Mensagem'), 'quero remarcar amanhã');
    await user.click(screen.getByRole('button', { name: /Atendimento anterior/ }));
    expect(screen.queryByLabelText('Mensagem')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /ICS Pré-atendimento/ }));
    expect(screen.getByLabelText('Mensagem')).toHaveValue('quero remarcar amanhã');
  });

  it('envia uma mensagem, troca de conversa e preserva o histórico ao vivo', async () => {
    const user = userEvent.setup();
    render(<ChatPanel transport={new MockTransport({ delays: instant })} patientName="Carla Mendes" />);
    await screen.findByText(/Como posso ajudar/);
    await user.type(screen.getByLabelText('Mensagem'), '2');
    await user.click(screen.getByRole('button', { name: 'Enviar' }));
    await waitFor(() => {
      expect(thread().getByText('2')).toBeInTheDocument();
    });
    await user.click(screen.getByRole('button', { name: /Exames e vacinas/ }));
    expect(thread().getByText(/campanha de influenza/i)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /ICS Pré-atendimento/ }));
    expect(thread().getByText('2')).toBeInTheDocument();
    expect(screen.getByLabelText('Mensagem')).toBeInTheDocument();
  });

  it('restaura a conversa no voltar e avançar do navegador', async () => {
    const user = userEvent.setup();
    render(<ChatPanel transport={new MockTransport({ delays: instant })} patientName="Carla Mendes" />);
    await screen.findByText(/Como posso ajudar/);
    await user.click(screen.getByRole('button', { name: /Atendimento anterior/ }));
    expect(thread().getByText(/remarcar a consulta da clínica da família/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Exames e vacinas/ }));
    expect(thread().getByText(/campanha de influenza/i)).toBeInTheDocument();

    act(() => {
      window.history.back();
    });
    expect(await screen.findByText(/remarcar a consulta da clínica da família/)).toBeInTheDocument();

    act(() => {
      window.history.forward();
    });
    expect(await screen.findByText(/campanha de influenza/i)).toBeInTheDocument();
  });

  it('na lista indica erro da sessão ao vivo ao trocar de conversa', async () => {
    const user = userEvent.setup();
    render(
      <ChatPanel transport={new MockTransport({ delays: instant, failConnect: true })} patientName="Carla Mendes" />,
    );
    expect(await screen.findByRole('alert')).toHaveTextContent(/conectar/i);
    await user.click(screen.getByRole('button', { name: /Atendimento anterior/ }));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /ICS Pré-atendimento/ })).toHaveAccessibleName(/erro/i);
    expect(activityBadge()).toHaveTextContent('Erro');
  });

  it('na lista indica envio em andamento ao trocar de conversa', async () => {
    const user = userEvent.setup();
    const transport = new ScriptedTransport();
    transport.holdSend = true;
    render(<ChatPanel transport={transport} patientName="Carla Mendes" />);
    await waitFor(() => {
      expect(transport.getStatus()).toBe('connected');
    });
    const conversationId = transport.lastSession?.conversationId ?? 'conv-web';
    act(() => {
      transport.emit({
        type: 'message',
        message: botText(conversationId, 'w1', 'Olá, Carla Mendes!\nComo posso ajudar?'),
      });
    });
    await screen.findByText(/Como posso ajudar/);
    await user.type(screen.getByLabelText('Mensagem'), 'oi');
    await user.click(screen.getByRole('button', { name: 'Enviar' }));
    await user.click(screen.getByRole('button', { name: /Atendimento anterior/ }));
    expect(screen.getByRole('button', { name: /ICS Pré-atendimento/ })).toHaveAccessibleName(/enviando/i);
    expect(activityBadge()).toHaveTextContent('Enviando…');
  });

  it('na lista indica mensagem não vista quando a resposta chega no histórico', async () => {
    const user = userEvent.setup();
    const transport = new ScriptedTransport();
    render(<ChatPanel transport={transport} patientName="Carla Mendes" />);
    const conversationId = await connectScripted(transport);
    await user.click(screen.getByRole('button', { name: /Atendimento anterior/ }));
    act(() => {
      transport.emit({
        type: 'message',
        message: botText(conversationId, 'late-1', 'Sua escolha foi registrada.'),
      });
    });
    await waitFor(() => {
      expect(activityBadge()).toHaveTextContent('Nova mensagem');
    });
    expect(screen.getByRole('button', { name: /ICS Pré-atendimento/ })).toHaveAccessibleName(/nova mensagem/i);
    expect(politeAnnouncements()).toHaveLength(1);
    expect(politeAnnouncements()[0]).toHaveTextContent('Nova mensagem');
    await user.click(screen.getByRole('button', { name: /ICS Pré-atendimento/ }));
    await waitFor(() => {
      expect(document.querySelector('.live-activity-badge')).toBeNull();
    });
    expect(screen.queryByText(/nova mensagem no ics pré-atendimento/i)).not.toBeInTheDocument();
  });

  it('mantém o item ao vivo visível na busca quando há erro', async () => {
    const user = userEvent.setup();
    render(
      <ChatPanel transport={new MockTransport({ delays: instant, failConnect: true })} patientName="Carla Mendes" />,
    );
    expect(await screen.findByRole('alert')).toHaveTextContent(/conectar/i);
    await user.type(screen.getByRole('searchbox', { name: 'Pesquisar conversa' }), 'zzzz-inexistente');
    expect(screen.getByRole('button', { name: /ICS Pré-atendimento/ })).toBeInTheDocument();
    expect(activityBadge()).toHaveTextContent('Erro');
    expect(screen.queryByText('Nenhum resultado encontrado')).not.toBeInTheDocument();
  });

  it('na conexão inicial o badge diz Conectando, não Reconectando', async () => {
    render(
      <ChatPanel
        transport={new MockTransport({ delays: { ...instant, typingMs: 400, replyMs: 400 } })}
        patientName="Carla Mendes"
      />,
    );
    await waitFor(() => {
      expect(activityBadge()).toHaveTextContent('Conectando');
    });
    expect(screen.queryByText('Reconectando')).not.toBeInTheDocument();
  });

  it('anuncia atividade sem duplicar o alerta de erro da conversa ao vivo', async () => {
    const user = userEvent.setup();
    render(
      <ChatPanel transport={new MockTransport({ delays: instant, failConnect: true })} patientName="Carla Mendes" />,
    );
    expect(await screen.findByRole('alert')).toHaveTextContent(/conectar/i);
    expect(liveRoles()).toEqual(['log', 'alert']);
    expect(activityAnnouncer()).toHaveTextContent('');
    expect(activityBadge()).toHaveTextContent('Erro');

    await user.click(screen.getByRole('button', { name: /Atendimento anterior/ }));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(activityAnnouncer()).toHaveTextContent('Erro');
    expect(activityBadge()).toHaveTextContent('Erro');
  });

  it('restaura a conversa selecionada a partir do history.state no remount', async () => {
    const user = userEvent.setup();
    const first = render(<ChatPanel transport={new MockTransport({ delays: instant })} patientName="Carla Mendes" />);
    await screen.findByText(/Como posso ajudar/);
    await user.click(screen.getByRole('button', { name: /Atendimento anterior/ }));
    expect(thread().getByText(/remarcar a consulta da clínica da família/)).toBeInTheDocument();
    first.unmount();
    render(<ChatPanel transport={new MockTransport({ delays: instant })} patientName="Carla Mendes" />);
    expect(await screen.findByText(/remarcar a consulta da clínica da família/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Atendimento anterior/ })).toHaveAttribute('aria-current', 'true');
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /ICS Pré-atendimento/ })).toHaveTextContent(/Carla Mendes/);
    });
    expect(document.querySelector('.live-activity-badge.is-unseen')).toBeNull();
    expect(activityAnnouncer()).toHaveTextContent('');
  });

  it('depois do reload no histórico, mensagem nova fica não vista', async () => {
    window.history.replaceState({ smPane: 'list', conversationId: 'ics-anterior' }, '');
    const transport = new ScriptedTransport();
    transport.holdConnect = true;
    render(<ChatPanel transport={transport} patientName="Carla Mendes" />);
    expect(await screen.findByText(/remarcar a consulta da clínica da família/)).toBeInTheDocument();
    await waitFor(() => {
      expect(transport.lastSession).toBeDefined();
    });
    const conversationId = transport.lastSession?.conversationId ?? 'conv-web';
    act(() => {
      transport.emit({
        type: 'message',
        message: botText(conversationId, 'w1', 'Olá, Carla Mendes!\nComo posso ajudar?'),
      });
    });
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /ICS Pré-atendimento/ })).toHaveTextContent(/Carla Mendes/);
    });
    act(() => {
      transport.releaseConnect();
    });
    await waitFor(() => {
      expect(transport.getStatus()).toBe('connected');
    });
    expect(document.querySelector('.live-activity-badge.is-unseen')).toBeNull();
    act(() => {
      transport.emit({
        type: 'message',
        message: botText(conversationId, 'after-reload', 'Atualização depois do reload.'),
      });
    });
    await waitFor(() => {
      expect(activityBadge()).toHaveTextContent('Nova mensagem');
    });
    expect(activityAnnouncer()).toHaveTextContent('Nova mensagem');
  });

  it('na lista indica reconexão da sessão ao vivo', async () => {
    const user = userEvent.setup();
    const transport = new ScriptedTransport();
    render(<ChatPanel transport={transport} patientName="Carla Mendes" />);
    await waitFor(() => {
      expect(transport.getStatus()).toBe('connected');
    });
    const conversationId = transport.lastSession?.conversationId ?? 'conv-web';
    act(() => {
      transport.emit({
        type: 'message',
        message: botText(conversationId, 'w1', 'Olá, Carla Mendes!\nComo posso ajudar?'),
      });
    });
    await screen.findByText(/Como posso ajudar/);
    await user.click(screen.getByRole('button', { name: /Atendimento anterior/ }));
    act(() => {
      transport.emit({ type: 'connection', status: 'connecting' });
    });
    expect(screen.getByRole('button', { name: /ICS Pré-atendimento/ })).toHaveAccessibleName(/reconectando/i);
    expect(activityBadge()).toHaveTextContent('Reconectando');
  });
});

describe('ChatPanel no mobile', () => {
  afterEach(() => {
    stubDesktopMatchMedia();
  });

  it('move o foco para o campo ao abrir o chat e devolve ao item ao voltar', async () => {
    stubMobileMatchMedia();
    const user = userEvent.setup();
    render(<ChatPanel transport={new MockTransport({ delays: instant })} patientName="Carla Mendes" />);
    await screen.findByText(/Como posso ajudar/);
    const liveItem = screen.getByRole('button', { name: /ICS Pré-atendimento/ });
    liveItem.focus();
    await user.keyboard('{Enter}');
    await waitFor(() => {
      expect(document.querySelector('.chat-header')).toHaveFocus();
    });
    await user.click(screen.getByRole('button', { name: 'Voltar' }));
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /ICS Pré-atendimento/ })).toHaveFocus();
    });
  });

  it('move o foco para o cabeçalho ao abrir um histórico', async () => {
    stubMobileMatchMedia();
    const user = userEvent.setup();
    render(<ChatPanel transport={new MockTransport({ delays: instant })} patientName="Carla Mendes" />);
    await screen.findByText(/Como posso ajudar/);
    screen.getByRole('button', { name: /Atendimento anterior/ }).focus();
    await user.keyboard('{Enter}');
    await waitFor(() => {
      expect(document.querySelector('.chat-header')).toHaveFocus();
    });
  });

  it('ao voltar no mobile, seleção e foco ficam no item de origem', async () => {
    stubMobileMatchMedia();
    const user = userEvent.setup();
    render(<ChatPanel transport={new MockTransport({ delays: instant })} patientName="Carla Mendes" />);
    await screen.findByText(/Como posso ajudar/);

    const historyItem = screen.getByRole('button', { name: /Atendimento anterior/ });
    historyItem.focus();
    await user.keyboard('{Enter}');
    await waitFor(() => {
      expect(document.querySelector('.chat-header')).toHaveFocus();
    });
    await user.click(screen.getByRole('button', { name: 'Voltar' }));
    await waitFor(() => {
      expect(historyItem).toHaveFocus();
    });
    expect(historyItem).toHaveAttribute('aria-current', 'true');

    const examsItem = screen.getByRole('button', { name: /Exames e vacinas/ });
    await user.click(examsItem);
    await waitFor(() => {
      expect(document.querySelector('.chat-header')).toHaveFocus();
    });
    act(() => {
      window.history.back();
    });
    await waitFor(() => {
      expect(examsItem).toHaveFocus();
    });
    expect(examsItem).toHaveAttribute('aria-current', 'true');
  });

  it('na lista, a resposta que chega com o chat ao vivo oculto vira nova mensagem', async () => {
    stubMobileMatchMedia();
    const user = userEvent.setup();
    const transport = new ScriptedTransport();
    render(<ChatPanel transport={transport} patientName="Carla Mendes" />);
    const conversationId = await connectScripted(transport);
    await user.click(screen.getByRole('button', { name: /ICS Pré-atendimento/ }));
    await user.type(screen.getByLabelText('Mensagem'), '2');
    await user.click(screen.getByRole('button', { name: 'Enviar' }));
    const sent = transport.sent.at(-1);
    act(() => {
      if (sent) {
        transport.emit({
          type: 'status',
          messageId: sent.clientId,
          clientId: sent.clientId,
          status: 'read',
        });
      }
    });
    await user.click(screen.getByRole('button', { name: 'Voltar' }));
    act(() => {
      transport.emit({
        type: 'message',
        message: botText(conversationId, 'reply-on-list', 'Você escolheu exames e resultados.'),
      });
    });
    await waitFor(() => {
      expect(activityBadge()).toHaveTextContent('Nova mensagem');
    });
    expect(activityAnnouncer()).toHaveTextContent('Nova mensagem');
    await user.click(screen.getByRole('button', { name: /ICS Pré-atendimento/ }));
    await waitFor(() => {
      expect(document.querySelector('.live-activity-badge.is-unseen')).toBeNull();
    });
    expect(activityAnnouncer()).toHaveTextContent('');
  });

  it('se o item de origem sumiu da lista, o foco volta para a busca', async () => {
    stubMobileMatchMedia();
    const user = userEvent.setup();
    render(<ChatPanel transport={new MockTransport({ delays: instant })} patientName="Carla Mendes" />);
    await screen.findByText(/Como posso ajudar/);
    await user.click(screen.getByRole('button', { name: /Atendimento anterior/ }));
    await waitFor(() => {
      expect(document.querySelector('.chat-header')).toHaveFocus();
    });
    await user.type(screen.getByRole('searchbox', { name: 'Pesquisar conversa' }), 'zzzz-inexistente');
    expect(screen.queryByRole('button', { name: /Atendimento anterior/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Voltar' }));
    await waitFor(() => {
      expect(screen.getByRole('searchbox', { name: 'Pesquisar conversa' })).toHaveFocus();
    });
  });

  it('indica nova mensagem no painel quando a resposta chega com o histórico aberto', async () => {
    stubMobileMatchMedia();
    const user = userEvent.setup();
    const transport = new ScriptedTransport();
    render(<ChatPanel transport={transport} patientName="Carla Mendes" />);
    const conversationId = await connectScripted(transport);
    await user.click(screen.getByRole('button', { name: /ICS Pré-atendimento/ }));
    await user.click(screen.getByRole('button', { name: 'Voltar' }));
    await user.click(screen.getByRole('button', { name: /Atendimento anterior/ }));
    act(() => {
      transport.emit({
        type: 'message',
        message: botText(conversationId, 'late-mobile', 'Sua escolha foi registrada.'),
      });
    });
    expect(await screen.findByRole('button', { name: /voltar, nova mensagem/i })).toBeInTheDocument();
    expect(screen.getByText(/nova mensagem no ics pré-atendimento/i)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /voltar, nova mensagem/i }));
    await user.click(screen.getByRole('button', { name: /ICS Pré-atendimento/ }));
    await waitFor(() => {
      expect(screen.queryByText(/nova mensagem no ics pré-atendimento/i)).not.toBeInTheDocument();
    });
  });
});

describe('ChatPanel mídia', () => {
  beforeEach(() => {
    stubDesktopMatchMedia();
  });

  it('anexa PNG válido, envia com legenda e mostra Foto na sidebar', async () => {
    const user = userEvent.setup();
    const urls = createFakeObjectUrls();
    render(
      <ChatPanel
        transport={new MockTransport({ delays: { ...instant, uploadChunkMs: 0 }, objectUrls: urls })}
        patientName="Carla Mendes"
        objectUrls={urls}
      />,
    );
    await screen.findByText(/Como posso ajudar/);
    const input = document.querySelector('input[type="file"]');
    if (!(input instanceof HTMLInputElement)) {
      throw new Error('esperava input file');
    }
    await user.upload(input, new File([new Uint8Array(12)], 'foto.png', { type: 'image/png' }));
    expect(screen.getByRole('region', { name: 'Pré-visualização do anexo' })).toBeInTheDocument();
    expect(screen.queryByRole('log', { name: 'Mensagens' })).not.toBeInTheDocument();
    await user.type(screen.getByLabelText('Legenda'), 'minha foto');
    await user.click(screen.getByRole('button', { name: 'Enviar' }));
    expect(await thread().findByText('minha foto')).toBeInTheDocument();
    expect(thread().getByRole('img', { name: 'minha foto' })).toBeVisible();
    await waitFor(() => {
      expect(screen.getByLabelText('Lida')).toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: /ICS Pré-atendimento/ })).toHaveTextContent('minha foto');
  });

  it('arquivo inválido mostra alerta e Fechar remove', async () => {
    const user = userEvent.setup();
    render(<ChatPanel transport={new MockTransport({ delays: instant })} patientName="Carla Mendes" />);
    await screen.findByText(/Como posso ajudar/);
    const input = document.querySelector('input[type="file"]');
    if (!(input instanceof HTMLInputElement)) {
      throw new Error('esperava input file');
    }
    fireEvent.change(input, {
      target: { files: [new File([new Uint8Array(8)], 'virus.exe', { type: 'application/octet-stream' })] },
    });
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/Formato não suportado: virus.exe/);
    await user.click(screen.getByRole('button', { name: 'Fechar' }));
    expect(screen.queryByText(/Formato não suportado/)).not.toBeInTheDocument();
  });

  it('histórico somente leitura não tem clipe', async () => {
    const user = userEvent.setup();
    render(<ChatPanel transport={new MockTransport({ delays: instant })} patientName="Carla Mendes" />);
    await screen.findByText(/Como posso ajudar/);
    await user.click(screen.getByRole('button', { name: /Atendimento anterior/ }));
    expect(await screen.findByText('Atendimento encerrado · somente leitura')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Anexar arquivo' })).not.toBeInTheDocument();
  });

  it('trocar de conversa com o preview aberto descarta o anexo', async () => {
    const user = userEvent.setup();
    const urls = createFakeObjectUrls();
    render(
      <ChatPanel
        transport={new MockTransport({ delays: instant, objectUrls: urls })}
        patientName="Carla Mendes"
        objectUrls={urls}
      />,
    );
    await screen.findByText(/Como posso ajudar/);
    const input = document.querySelector('input[type="file"]');
    if (!(input instanceof HTMLInputElement)) {
      throw new Error('esperava input file');
    }
    await user.upload(input, new File([new Uint8Array(12)], 'foto.png', { type: 'image/png' }));
    expect(screen.getByRole('region', { name: 'Pré-visualização do anexo' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Atendimento anterior/ }));
    expect(screen.queryByRole('region', { name: 'Pré-visualização do anexo' })).not.toBeInTheDocument();
  });

  it('depois de Enviar no preview o foco volta para Anexar arquivo', async () => {
    const user = userEvent.setup();
    const urls = createFakeObjectUrls();
    render(
      <ChatPanel
        transport={new MockTransport({ delays: { ...instant, uploadChunkMs: 0 }, objectUrls: urls })}
        patientName="Carla"
        objectUrls={urls}
      />,
    );
    await screen.findByText(/Como posso ajudar/);
    await user.upload(fileInput(), png());
    await user.click(screen.getByRole('button', { name: 'Enviar' }));
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Anexar arquivo' })).toHaveFocus();
    });
  });

  it('rascunho longo não vira legenda acima de 1024 caracteres', async () => {
    const user = userEvent.setup();
    const urls = createFakeObjectUrls();
    const transport = new ScriptedTransport();
    render(<ChatPanel transport={transport} patientName="Carla" objectUrls={urls} />);
    await waitFor(() => {
      expect(transport.getStatus()).toBe('connected');
    });
    const field = screen.getByLabelText('Mensagem');
    await user.click(field);
    await user.paste('x'.repeat(1500));
    await user.upload(fileInput(), png());
    await user.click(screen.getByRole('button', { name: 'Enviar' }));
    await waitFor(() => {
      expect(transport.sent.length).toBeGreaterThan(0);
    });
    const payload = transport.sent.at(-1)?.payload;
    const caption = payload && 'caption' in payload ? payload.caption ?? '' : '';
    expect(caption.length).toBeLessThanOrEqual(1024);
    expect(screen.getByLabelText('Mensagem')).toHaveValue('x'.repeat(476));
  });

  it('rascunho com emoji no corte 1023-1024 não parte o par surrogate', async () => {
    const user = userEvent.setup();
    const urls = createFakeObjectUrls();
    const transport = new ScriptedTransport();
    render(<ChatPanel transport={transport} patientName="Carla" objectUrls={urls} />);
    await waitFor(() => {
      expect(transport.getStatus()).toBe('connected');
    });
    const draft = `${'a'.repeat(1023)}😀fim`;
    fireEvent.change(screen.getByLabelText('Mensagem'), { target: { value: draft } });
    await user.upload(fileInput(), png());
    await user.click(screen.getByRole('button', { name: 'Enviar' }));
    await waitFor(() => {
      expect(transport.sent.length).toBeGreaterThan(0);
    });
    const payload = transport.sent.at(-1)?.payload;
    const caption = payload && 'caption' in payload ? (payload.caption ?? '') : '';
    const leftover = screen.getByLabelText('Mensagem');
    if (!(leftover instanceof HTMLTextAreaElement)) {
      throw new Error('esperava textarea');
    }
    expect(caption + leftover.value).toBe(draft);
    expect(isWellFormed(caption)).toBe(true);
    expect(isWellFormed(leftover.value)).toBe(true);
  });

  it('rascunho com emoji ZWJ no corte permanece inteiro na legenda ou no resto', async () => {
    const user = userEvent.setup();
    const urls = createFakeObjectUrls();
    const transport = new ScriptedTransport();
    render(<ChatPanel transport={transport} patientName="Carla" objectUrls={urls} />);
    await waitFor(() => {
      expect(transport.getStatus()).toBe('connected');
    });
    const family = '👨‍👩‍👧‍👦';
    const draft = `${'a'.repeat(1022)}${family}fim`;
    fireEvent.change(screen.getByLabelText('Mensagem'), { target: { value: draft } });
    await user.upload(fileInput(), png());
    await user.click(screen.getByRole('button', { name: 'Enviar' }));
    await waitFor(() => {
      expect(transport.sent.length).toBeGreaterThan(0);
    });
    const payload = transport.sent.at(-1)?.payload;
    const caption = payload && 'caption' in payload ? (payload.caption ?? '') : '';
    const leftoverField = screen.getByLabelText('Mensagem');
    if (!(leftoverField instanceof HTMLTextAreaElement)) {
      throw new Error('esperava textarea');
    }
    const leftover = leftoverField.value;
    expect(caption + leftover).toBe(draft);
    expect(caption.includes(family) || leftover.startsWith(family)).toBe(true);
    expect(isWellFormed(caption)).toBe(true);
    expect(isWellFormed(leftover)).toBe(true);
  });

  it('Baixar no visualizador usa a extensão do arquivo, não foto.jpg', async () => {
    const user = userEvent.setup();
    const urls = createFakeObjectUrls();
    render(
      <ChatPanel
        transport={new MockTransport({ delays: { ...instant, uploadChunkMs: 0 }, objectUrls: urls })}
        patientName="Carla"
        objectUrls={urls}
      />,
    );
    await screen.findByText(/Como posso ajudar/);
    await user.upload(fileInput(), png('raiox.png'));
    await user.click(screen.getByRole('button', { name: 'Enviar' }));
    await user.click(await screen.findByRole('button', { name: 'Abrir foto em tela cheia' }));
    const dialog = screen.getByRole('dialog', { name: 'Foto em tela cheia' });
    const link = within(dialog).getByRole('link', { name: 'Baixar foto' });
    expect(link.getAttribute('download')).not.toBe('foto.jpg');
    expect(link.getAttribute('download') ?? '').toMatch(/\.png$/);
  });

  it('cancelar o upload devolve o foco para Anexar arquivo', async () => {
    const user = userEvent.setup();
    const urls = createFakeObjectUrls();
    const transport = new ScriptedTransport();
    transport.holdUpload = true;
    render(<ChatPanel transport={transport} patientName="Carla" objectUrls={urls} />);
    await waitFor(() => {
      expect(transport.getStatus()).toBe('connected');
    });
    await user.upload(fileInput(), png());
    await user.click(screen.getByRole('button', { name: 'Enviar' }));
    await user.click(await screen.findByRole('button', { name: 'Cancelar envio de exame.png' }));
    await waitFor(() => {
      expect(document.activeElement).not.toBe(document.body);
      expect(screen.getByRole('button', { name: 'Anexar arquivo' })).toHaveFocus();
    });
  });

  it('falha do send depois do upload → Reenviar reusa a URL remota sem novo upload', async () => {
    const user = userEvent.setup();
    const urls = createFakeObjectUrls();
    const transport = new ScriptedTransport();
    transport.failSend = true;
    render(<ChatPanel transport={transport} patientName="Carla" objectUrls={urls} />);
    await waitFor(() => {
      expect(transport.getStatus()).toBe('connected');
    });
    await user.upload(fileInput(), png());
    await user.click(screen.getByRole('button', { name: 'Enviar' }));
    const resend = await screen.findByRole('button', { name: 'Reenviar mensagem' });
    expect(transport.uploads).toHaveLength(1);
    transport.failSend = false;
    await user.click(resend);
    await waitFor(() => {
      expect(transport.sent.length).toBe(2);
    });
    expect(transport.uploads).toHaveLength(1);
    const payload = transport.sent.at(-1)?.payload;
    expect(payload && 'url' in payload ? payload.url : '').toBe('uploaded:exame.png');
    expect(transport.sent[0]?.clientId).toBe(transport.sent[1]?.clientId);
  });

  it('falha de upload aparece na atividade ao trocar de conversa e no voltar/avançar', async () => {
    const user = userEvent.setup();
    const urls = createFakeObjectUrls();
    const transport = new ScriptedTransport();
    transport.failUpload = true;
    render(<ChatPanel transport={transport} patientName="Carla" objectUrls={urls} />);
    await waitFor(() => {
      expect(transport.getStatus()).toBe('connected');
    });
    await user.upload(fileInput(), png());
    await user.click(screen.getByRole('button', { name: 'Enviar' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/Falha ao enviar exame.png/);
    await user.click(screen.getByRole('button', { name: /Atendimento anterior/ }));
    expect(screen.getByRole('button', { name: /ICS Pré-atendimento/ })).toHaveAccessibleName(/erro/i);
    expect(activityBadge()).toHaveTextContent('Erro');
    expect(activityAnnouncer()).toHaveTextContent('Erro');
    window.history.back();
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/Falha ao enviar exame.png/);
    });
    expect(activityAnnouncer()).toHaveTextContent('');
    window.history.forward();
    await waitFor(() => {
      expect(activityAnnouncer()).toHaveTextContent('Erro');
    });
    expect(activityBadge()).toHaveTextContent('Erro');
  });

  it('progresso do upload não rouba o foco de Baixar foto', async () => {
    const user = userEvent.setup();
    const urls = createFakeObjectUrls();
    const transport = new ScriptedTransport();
    transport.holdUpload = true;
    render(<ChatPanel transport={transport} patientName="Carla" objectUrls={urls} />);
    await waitFor(() => {
      expect(transport.getStatus()).toBe('connected');
    });
    await user.upload(fileInput(), png());
    await user.click(screen.getByRole('button', { name: 'Enviar' }));
    await user.click(await screen.findByRole('button', { name: 'Abrir foto em tela cheia' }));
    const dialog = screen.getByRole('dialog', { name: 'Foto em tela cheia' });
    const download = within(dialog).getByRole('link', { name: 'Baixar foto' });
    download.focus();
    expect(download).toHaveFocus();
    act(() => {
      transport.progressUpload(0, 6);
    });
    expect(download).toHaveFocus();
    expect(within(dialog).getByRole('button', { name: 'Fechar foto' })).not.toHaveFocus();
  });

  it('o visualizador acompanha a URL da mensagem depois do upload', async () => {
    const user = userEvent.setup();
    const urls = createFakeObjectUrls();
    const transport = new ScriptedTransport();
    transport.holdUpload = true;
    render(<ChatPanel transport={transport} patientName="Carla" objectUrls={urls} />);
    await waitFor(() => {
      expect(transport.getStatus()).toBe('connected');
    });
    await user.upload(fileInput(), png());
    await user.click(screen.getByRole('button', { name: 'Enviar' }));
    await user.click(await screen.findByRole('button', { name: 'Abrir foto em tela cheia' }));
    const dialog = screen.getByRole('dialog', { name: 'Foto em tela cheia' });
    const previewSrc = within(dialog).getByRole('img').getAttribute('src');
    expect(previewSrc).toBeTruthy();
    act(() => {
      transport.resolveUpload(0, 'uploaded:exame.png');
    });
    await waitFor(() => {
      expect(within(dialog).getByRole('img')).toHaveAttribute('src', 'uploaded:exame.png');
    });
    expect(within(dialog).getByRole('link', { name: 'Baixar foto' })).toHaveAttribute('href', 'uploaded:exame.png');
    expect(urls.revoked).toContain(previewSrc);
  });

  it('depois de ended o Tentar de novo do upload falho não fica ativo', async () => {
    const user = userEvent.setup();
    const urls = createFakeObjectUrls();
    const transport = new ScriptedTransport();
    transport.failUpload = true;
    render(<ChatPanel transport={transport} patientName="Carla" objectUrls={urls} />);
    await waitFor(() => {
      expect(transport.getStatus()).toBe('connected');
    });
    await user.upload(fileInput(), png());
    await user.click(screen.getByRole('button', { name: 'Enviar' }));
    expect(await screen.findByRole('button', { name: 'Tentar enviar exame.png de novo' })).toBeEnabled();
    act(() => {
      transport.emit({ type: 'ended', conversationId: transport.lastSession?.conversationId ?? 'c1' });
    });
    await screen.findByRole('button', { name: 'Iniciar novo atendimento' });
    expect(screen.queryByRole('button', { name: 'Tentar enviar exame.png de novo' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Tentar de novo' })).not.toBeInTheDocument();
  });

  it('encerrar com o visualizador aberto devolve o foco a um destino válido', async () => {
    const user = userEvent.setup();
    const urls = createFakeObjectUrls();
    const transport = new ScriptedTransport();
    transport.holdUpload = true;
    render(<ChatPanel transport={transport} patientName="Carla" objectUrls={urls} />);
    await waitFor(() => {
      expect(transport.getStatus()).toBe('connected');
    });
    await user.upload(fileInput(), png());
    await user.click(screen.getByRole('button', { name: 'Enviar' }));
    await user.click(await screen.findByRole('button', { name: 'Abrir foto em tela cheia' }));
    expect(screen.getByRole('button', { name: 'Fechar foto' })).toHaveFocus();
    act(() => {
      transport.emit({ type: 'ended', conversationId: transport.lastSession?.conversationId ?? 'c1' });
    });
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'Fechar foto' })).not.toBeInTheDocument();
      expect(document.activeElement).not.toBe(document.body);
    });
    const focused = document.activeElement;
    expect(
      focused === document.querySelector('.chat-header') ||
        focused === screen.getByRole('button', { name: 'Iniciar novo atendimento' }) ||
        focused?.getAttribute('aria-label') === 'Anexar arquivo' ||
        focused?.getAttribute('aria-label') === 'Mensagem',
    ).toBe(true);
  });
});

