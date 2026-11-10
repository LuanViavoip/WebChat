import { StrictMode } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
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

describe('ChatPanel', () => {
  it('mostra boas-vindas pelo nome do paciente', async () => {
    render(<ChatPanel transport={new MockTransport({ delays: instant })} patientName="Carla Mendes" />);
    expect(await screen.findByText(/Carla Mendes/)).toBeInTheDocument();
    expect(screen.getByText(/Como posso ajudar/)).toBeInTheDocument();
  });

  it('sobrevive ao StrictMode sem duplicar o menu de boas-vindas', async () => {
    render(
      <StrictMode>
        <ChatPanel transport={new MockTransport({ delays: instant })} patientName="Carla Mendes" />
      </StrictMode>,
    );
    expect(await screen.findByText(/Carla Mendes/)).toBeInTheDocument();
    expect(screen.getAllByText(/Como posso ajudar/)).toHaveLength(1);
  });

  it('clicar no menu envia a opção e mostra a resposta do bot', async () => {
    const user = userEvent.setup();
    render(<ChatPanel transport={new MockTransport({ delays: instant })} patientName="Carla Mendes" />);
    await screen.findByText(/Como posso ajudar/);
    await user.click(screen.getByRole('button', { name: /Primeira vez/ }));
    expect(await screen.findByText('1')).toBeInTheDocument();
    expect(await screen.findByText(/Você escolheu Primeira vez/)).toBeInTheDocument();
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
    expect(await screen.findByText(/Carla Mendes/)).toBeInTheDocument();
  });

  it('mantém o texto em erro e permite reenviar', async () => {
    const user = userEvent.setup();
    const transport = new MockTransport({ delays: instant, failSend: true });
    render(<ChatPanel transport={transport} patientName="Carla Mendes" />);
    await screen.findByText(/Como posso ajudar/);
    await user.type(screen.getByLabelText('Mensagem'), 'preciso de ajuda');
    await user.click(screen.getByRole('button', { name: 'Enviar' }));
    expect(await screen.findByText('preciso de ajuda')).toBeInTheDocument();
    expect(screen.getByLabelText('Erro ao enviar')).toBeInTheDocument();
    transport.failSend = false;
    await user.click(screen.getByRole('button', { name: 'Reenviar mensagem' }));
    await waitFor(() => {
      expect(screen.getByLabelText('Lida')).toBeInTheDocument();
    });
    expect(screen.getByText('preciso de ajuda')).toBeInTheDocument();
  });
});
