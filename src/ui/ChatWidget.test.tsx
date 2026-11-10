import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MockTransport } from '../transport/MockTransport';
import { ChatWidget } from './ChatWidget';

const instant = {
  typingMs: 0,
  sentMs: 0,
  deliveredMs: 0,
  readMs: 0,
  replyMs: 0,
};

describe('ChatWidget', () => {
  it('abre e fecha o painel flutuante', async () => {
    const user = userEvent.setup();
    render(<ChatWidget transport={new MockTransport({ delays: instant })} patientName="Carla" />);
    await user.click(screen.getByRole('button', { name: 'Abrir chat de atendimento' }));
    expect(await screen.findByText(/Carla/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Fechar chat' }));
    expect(screen.queryByLabelText('Conversa com o ICS')).not.toBeInTheDocument();
  });

  it('devolve o foco ao botão de abrir ao fechar', async () => {
    const user = userEvent.setup();
    render(<ChatWidget transport={new MockTransport({ delays: instant })} patientName="Carla" />);
    await user.click(screen.getByRole('button', { name: 'Abrir chat de atendimento' }));
    await screen.findByRole('button', { name: 'Fechar chat' });
    await user.click(screen.getByRole('button', { name: 'Fechar chat' }));
    expect(screen.getByRole('button', { name: 'Abrir chat de atendimento' })).toHaveFocus();
  });
});
