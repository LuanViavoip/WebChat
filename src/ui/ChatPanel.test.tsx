import { StrictMode } from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ChatPanel } from './ChatPanel';
import { MockTransport } from '../transport/MockTransport';

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

const IMPLICIT_LIVE = '[role="log"], [role="status"], [role="alert"], [role="marquee"], [role="timer"]';

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
    expect(screen.getByRole('button', { name: /Atendimento anterior/ })).toBeDisabled();
    expect(screen.getAllByText('Demonstração')).toHaveLength(2);
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
    expect(screen.getByRole('button', { name: 'Anexar (em breve)' })).toBeDisabled();
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

  it('usa uma única região viva (explícita ou implícita) para anúncios', async () => {
    render(<ChatPanel transport={new MockTransport({ delays: instant })} patientName="Carla Mendes" />);
    await screen.findByText(/Como posso ajudar/);
    const live = liveRegions(document);
    expect(live).toHaveLength(1);
    expect(live[0]?.getAttribute('role')).toBe('log');
    expect(live[0]?.querySelector('[aria-live], [role="log"], [role="status"], [role="alert"]')).toBeNull();
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
});
