import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from './App';
import { stubDesktopMatchMedia } from './test/matchMedia';
import { MockTransport } from './transport/MockTransport';
import { SESSION_STORAGE_KEY } from './ui/sessionIdentity';

const instant = { connectMs: 0, sentMs: 0, deliveredMs: 0, readMs: 0 };

function transport() {
  return new MockTransport({ delays: instant });
}

beforeEach(() => {
  stubDesktopMatchMedia();
});

afterEach(() => {
  window.sessionStorage.clear();
  window.history.replaceState(null, '', '/');
});

async function waitForChat() {
  await waitFor(() => {
    expect(screen.getByRole('textbox', { name: /mensagem/i })).toBeEnabled();
  });
}

describe('App: Entrar como', () => {
  it('sem sessão mostra Entrar como', () => {
    render(<App transport={transport()} />);
    expect(screen.getByRole('heading', { level: 1, name: 'Entrar como' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Lista de conversas')).not.toBeInTheDocument();
  });

  it('escolher um usuário entra no chat dele e guarda a sessão da aba', async () => {
    const user = userEvent.setup();
    render(<App transport={transport()} />);
    await user.click(screen.getByRole('button', { name: /Bruno Costa/ }));
    await waitForChat();
    expect(window.sessionStorage.getItem(SESSION_STORAGE_KEY)).toBe('ics-bruno');
    const sidebar = within(screen.getByLabelText('Lista de conversas'));
    expect(sidebar.getByText('Bruno Costa')).toBeInTheDocument();
    expect(sidebar.getByText('Agente · ICS Saúde')).toBeInTheDocument();
  });

  it('?como= entra direto, e o tenant vem do usuário', async () => {
    window.history.replaceState(null, '', '/?como=bv-paula');
    render(<App transport={transport()} />);
    await waitForChat();
    const sidebar = within(screen.getByLabelText('Lista de conversas'));
    expect(sidebar.getByText('Agente · Clínica Boa Vista')).toBeInTheDocument();
    expect(sidebar.getByRole('button', { name: /Otávio Reis/ })).toBeInTheDocument();
    expect(sidebar.queryByRole('button', { name: /Carla/ })).not.toBeInTheDocument();
  });

  it('?como= inválido mostra Entrar como', () => {
    window.history.replaceState(null, '', '/?como=ninguem');
    render(<App transport={transport()} />);
    expect(screen.getByRole('heading', { level: 1, name: 'Entrar como' })).toBeInTheDocument();
  });

  it('a sessão da aba sobrevive ao reload (remount)', async () => {
    const user = userEvent.setup();
    const first = render(<App transport={transport()} />);
    await user.click(screen.getByRole('button', { name: /Ana Souza/ }));
    await waitForChat();
    first.unmount();
    render(<App transport={transport()} />);
    await waitForChat();
    expect(screen.getByText('Agente · ICS Saúde')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Entrar como' })).not.toBeInTheDocument();
  });
});

describe('App: Trocar usuário', () => {
  it('limpa a sessão da aba, para a ChatSession anterior e volta ao Entrar como', async () => {
    const user = userEvent.setup();
    window.history.replaceState(null, '', '/?como=ics-bruno&falha=upload');
    const t = transport();
    const disconnect = vi.spyOn(t, 'disconnect');
    render(<App transport={t} />);
    await waitForChat();
    disconnect.mockClear();
    await user.click(screen.getByRole('button', { name: 'Trocar usuário' }));
    expect(screen.getByRole('heading', { level: 1, name: 'Entrar como' })).toBeInTheDocument();
    expect(window.sessionStorage.getItem(SESSION_STORAGE_KEY)).toBeNull();
    expect(disconnect).toHaveBeenCalled();
    expect(window.location.search).toBe('?falha=upload');
  });

  it('o próximo usuário reconecta e reseleciona uma conversa dele', async () => {
    const user = userEvent.setup();
    const t = transport();
    window.history.replaceState(null, '', '/?como=ics-carla');
    render(<App transport={t} />);
    await waitForChat();
    expect(screen.getByRole('heading', { level: 2, name: 'Ana Souza' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Trocar usuário' }));
    await user.click(screen.getByRole('button', { name: /Paula Teixeira/ }));
    await waitForChat();
    const header = screen.getByRole('heading', { level: 2, name: /Otávio Reis|Rui Cardoso/ });
    expect(header).toBeInTheDocument();
    expect(screen.queryByText('Bruno Costa')).not.toBeInTheDocument();
  });
});

describe('App: Administração', () => {
  it('o admin vê o link, abre o console e volta ao chat', async () => {
    const user = userEvent.setup();
    window.history.replaceState(null, '', '/?como=ics-marcos');
    render(<App transport={transport()} />);
    await waitForChat();
    await user.click(screen.getByRole('button', { name: 'Administração' }));
    expect(screen.getByRole('heading', { level: 1, name: 'Administração' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Voltar ao chat' }));
    await waitForChat();
  });

  it.each(['ics-carla', 'ics-bruno'])('%s não vê o link de Administração', async (userId) => {
    window.history.replaceState(null, '', `/?como=${userId}`);
    render(<App transport={transport()} />);
    await waitForChat();
    expect(screen.queryByRole('button', { name: /Administração/ })).not.toBeInTheDocument();
  });
});
