import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MockTransport } from '../transport/MockTransport';
import { LIVE_CONVERSATION_ID } from '../transport/mock/seed';
import { ChatPanel } from '../ui/ChatPanel';

const instant = {
  connectMs: 0,
  sentMs: 0,
  deliveredMs: 0,
  readMs: 0,
};

beforeEach(() => {
  window.history.replaceState({ smPane: 'list', conversationId: LIVE_CONVERSATION_ID }, '');
});

describe('estados representativos de contraste', () => {
  it('renderiza erro, item ativo, badge de erro e foco para o e2e de estilos computados', async () => {
    const user = userEvent.setup();
    render(<ChatPanel transport={new MockTransport({ delays: instant, failSend: true })} />);
    await user.type(await screen.findByRole('textbox', { name: /mensagem/i }), 'oi');
    await user.click(await screen.findByRole('button', { name: 'Enviar' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveClass('session-banner-error');

    const active = screen.getByRole('button', { name: /Bruno Costa/ });
    expect(active).toHaveClass('is-active');
    expect(document.querySelector('.live-activity-badge.is-error')).not.toBeNull();
    active.focus();
    expect(active).toHaveFocus();
  });
});
