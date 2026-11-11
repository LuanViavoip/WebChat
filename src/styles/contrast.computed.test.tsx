import { render, screen } from '@testing-library/react';
import { MockTransport } from '../transport/MockTransport';
import { ChatPanel } from '../ui/ChatPanel';

const instant = {
  typingMs: 0,
  sentMs: 0,
  deliveredMs: 0,
  readMs: 0,
  replyMs: 0,
};

describe('estados representativos de contraste', () => {
  it('renderiza erro, item ativo e foco para o e2e de estilos computados', async () => {
    render(<ChatPanel transport={new MockTransport({ delays: instant, failConnect: true })} patientName="Carla" />);
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveClass('session-banner-error');

    const active = screen.getByRole('button', { name: /ICS Pré-atendimento/ });
    expect(active).toHaveClass('is-active');

    const history = screen.getByRole('button', { name: /Atendimento anterior/ });
    history.focus();
    expect(history).toHaveFocus();
  });
});
