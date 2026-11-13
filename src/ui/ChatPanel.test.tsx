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
  connectMs: 0,
  sentMs: 0,
  deliveredMs: 0,
  readMs: 0,
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

function incomingText(conversationId: string, id: string, text: string): TextMessage {
  return {
    id,
    conversationId,
    direction: 'agent',
    author: { id: 'agent-1', name: 'Colega' },
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

async function readyComposer() {
  const field = await screen.findByRole('textbox', { name: /mensagem/i });
  await waitFor(() => {
    expect(field).toBeEnabled();
  });
  return field;
}

describe('ChatPanel', () => {
  it('mostra a conversa de teste na lista', async () => {
    render(<ChatPanel transport={new MockTransport({ delays: instant })} />);
    await readyComposer();
    expect(screen.getByLabelText('Lista de conversas')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Conversa de teste/ })).toHaveAttribute('aria-current', 'true');
    expect(screen.getByRole('log')).toHaveTextContent('Nenhuma mensagem ainda');
  });

  it('Tab alcança o item da lista de conversas', async () => {
    const user = userEvent.setup();
    render(<ChatPanel transport={new MockTransport({ delays: instant })} />);
    await readyComposer();
    const liveItem = screen.getByRole('button', { name: /Conversa de teste/ });
    for (let step = 0; step < 24 && document.activeElement !== liveItem; step += 1) {
      await user.tab();
    }
    expect(liveItem).toHaveFocus();
  });

  it('não mostra conversas no filtro Não lidas', async () => {
    const user = userEvent.setup();
    render(<ChatPanel transport={new MockTransport({ delays: instant })} />);
    await readyComposer();
    await user.click(screen.getByRole('button', { name: 'Não lidas' }));
    expect(screen.queryByRole('button', { name: /Conversa de teste/ })).not.toBeInTheDocument();
    expect(screen.getByText('Nenhuma conversa não lida')).toBeInTheDocument();
  });

  it('mostra Nenhum resultado encontrado quando a busca no filtro Tudo não acha nada', async () => {
    const user = userEvent.setup();
    render(<ChatPanel transport={new MockTransport({ delays: instant })} />);
    await readyComposer();
    await user.type(screen.getByRole('searchbox', { name: 'Pesquisar conversa' }), 'zzzz-inexistente');
    expect(screen.getByText('Nenhum resultado encontrado')).toBeInTheDocument();
  });

  it('mostra o foco visível no campo de busca da barra lateral', async () => {
    const user = userEvent.setup();
    render(<ChatPanel transport={new MockTransport({ delays: instant })} />);
    await readyComposer();
    const search = screen.getByRole('searchbox', { name: 'Pesquisar conversa' });
    const shell = search.closest('.sidebar-search');
    expect(shell).not.toBeNull();
    for (let step = 0; step < 12 && document.activeElement !== search; step += 1) {
      await user.tab();
    }
    expect(search).toHaveFocus();
    expect(shell?.matches(':focus-within')).toBe(true);
  });

  it('sobrevive ao StrictMode sem duplicar a conexão', async () => {
    const transport = new MockTransport({ delays: instant });
    const connect = vi.spyOn(transport, 'connect');
    render(
      <StrictMode>
        <ChatPanel transport={transport} />
      </StrictMode>,
    );
    await readyComposer();
    expect(connect.mock.calls.length).toBeGreaterThan(0);
    expect(screen.getAllByRole('button', { name: /Conversa de teste/ })).toHaveLength(1);
    expect(screen.getByRole('log', { name: 'Mensagens' }).querySelectorAll('.bubble')).toHaveLength(0);
  });

  it('atualiza o status da mensagem enviada até lida', async () => {
    const user = userEvent.setup();
    render(<ChatPanel transport={new MockTransport({ delays: instant })} />);
    const field = await readyComposer();
    await user.type(field, '2');
    await user.click(screen.getByRole('button', { name: 'Enviar' }));
    await waitFor(() => {
      expect(screen.getByLabelText('Lida')).toBeInTheDocument();
    });
  });

  it('mostra erro de conexão e reconecta', async () => {
    const user = userEvent.setup();
    const transport = new MockTransport({ delays: instant, failConnect: true });
    render(<ChatPanel transport={transport} />);
    expect(await screen.findByRole('alert')).toHaveTextContent(/conectar/i);
    transport.failConnect = false;
    await user.click(screen.getByRole('button', { name: 'Reconectar' }));
    await readyComposer();
  });

  it('com falha de conexão, composer, clipe e drop ficam desligados', async () => {
    const transport = new ScriptedTransport();
    transport.failConnect = true;
    render(<ChatPanel transport={transport} />);
    expect(await screen.findByRole('alert')).toHaveTextContent(/conectar/i);
    expect(screen.getByRole('textbox', { name: /mensagem/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Anexar arquivo' })).toBeDisabled();
    const zone = document.querySelector('.wa-chat');
    if (!(zone instanceof HTMLElement)) {
      throw new Error('esperava a zona de drop');
    }
    const file = new File([new Uint8Array(4)], 'foto.png', { type: 'image/png' });
    fireEvent.dragEnter(zone, { dataTransfer: { types: ['Files'], files: [file] } });
    fireEvent.drop(zone, { dataTransfer: { types: ['Files'], files: [file] } });
    expect(screen.queryByRole('region', { name: 'Pré-visualização do anexo' })).toBeNull();
  });

  it('falha de envio → Reconectar preserva texto e Reenviar', async () => {
    const user = userEvent.setup();
    const transport = new MockTransport({ delays: instant, failSend: true });
    render(<ChatPanel transport={transport} />);
    const field = await readyComposer();
    await user.type(field, 'preciso de ajuda');
    await user.click(screen.getByRole('button', { name: 'Enviar' }));
    expect(await screen.findByRole('button', { name: 'Reenviar mensagem' })).toBeInTheDocument();
    expect(thread().getByText('preciso de ajuda')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Reconectar' }));
    expect(thread().getByText('preciso de ajuda')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reenviar mensagem' })).toBeInTheDocument();
  });

  it('usa o log como única região viva no estado normal', async () => {
    render(<ChatPanel transport={new MockTransport({ delays: instant })} />);
    await readyComposer();
    expect(liveRoles()).toEqual(['log']);
    expect(activityAnnouncer()).toHaveTextContent('');
    expect(screen.getByRole('log', { name: 'Mensagens' })).not.toHaveAttribute('aria-live', 'off');
  });

  it('no erro de conexão o log permanece ativo e o banner é o único alerta', async () => {
    render(<ChatPanel transport={new MockTransport({ delays: instant, failConnect: true })} />);
    expect(await screen.findByRole('alert')).toHaveTextContent(/conectar/i);
    expect(liveRoles()).toEqual(['log', 'alert']);
    expect(screen.getByRole('log', { name: 'Mensagens' })).not.toHaveAttribute('aria-live', 'off');
  });

  it('no erro de envio o log permanece ativo junto do alerta', async () => {
    const user = userEvent.setup();
    const transport = new MockTransport({ delays: instant, failSend: true });
    render(<ChatPanel transport={transport} />);
    const field = await readyComposer();
    await user.type(field, 'oi');
    await user.click(screen.getByRole('button', { name: 'Enviar' }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(liveRoles()).toEqual(['log', 'alert']);
  });

  it('resposta após falha de envio entra no role=log ativo', async () => {
    const user = userEvent.setup();
    const transport = new ScriptedTransport();
    render(<ChatPanel transport={transport} />);
    await readyComposer();
    const conversationId = transport.lastSession?.conversationId ?? 'conv-web';
    transport.failSend = true;
    await user.type(screen.getByLabelText('Mensagem'), 'oi');
    await user.click(screen.getByRole('button', { name: 'Enviar' }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    const log = screen.getByRole('log', { name: 'Mensagens' });
    act(() => {
      transport.emit({
        type: 'message',
        message: incomingText(conversationId, 'pending-reply', 'Resposta pendente chegou'),
      });
    });
    expect(within(log).getByText('Resposta pendente chegou')).toBeInTheDocument();
    expect(liveRoles()).toEqual(['log', 'alert']);
  });

  it('mantém o texto em erro e permite reenviar', async () => {
    const user = userEvent.setup();
    const transport = new MockTransport({ delays: instant, failSend: true });
    render(<ChatPanel transport={transport} />);
    const field = await readyComposer();
    await user.type(field, 'preciso de ajuda');
    await user.click(screen.getByRole('button', { name: 'Enviar' }));
    expect(await screen.findByRole('button', { name: 'Reenviar mensagem' })).toBeInTheDocument();
    expect(thread().getByText('preciso de ajuda')).toBeInTheDocument();
    expect(screen.getByLabelText('Erro ao enviar')).toBeInTheDocument();
    transport.failSend = false;
    await user.click(screen.getByRole('button', { name: 'Reenviar mensagem' }));
    await waitFor(() => {
      expect(screen.getByLabelText('Lida')).toBeInTheDocument();
    });
  });

  it('mantém o item ao vivo visível na busca quando há erro', async () => {
    const user = userEvent.setup();
    render(<ChatPanel transport={new MockTransport({ delays: instant, failConnect: true })} />);
    expect(await screen.findByRole('alert')).toHaveTextContent(/conectar/i);
    await user.type(screen.getByRole('searchbox', { name: 'Pesquisar conversa' }), 'zzzz-inexistente');
    expect(screen.getByRole('button', { name: /Conversa de teste/ })).toBeInTheDocument();
    expect(activityBadge()).toHaveTextContent('Erro');
    expect(screen.queryByText('Nenhum resultado encontrado')).not.toBeInTheDocument();
  });

  it('na conexão inicial o badge diz Conectando, não Reconectando', async () => {
    render(
      <ChatPanel transport={new MockTransport({ delays: { ...instant, connectMs: 400 } })} />,
    );
    await waitFor(() => {
      expect(activityBadge()).toHaveTextContent('Conectando');
    });
    expect(screen.queryByText('Reconectando')).not.toBeInTheDocument();
  });

  it('anuncia atividade sem duplicar o alerta de erro da conversa ao vivo', async () => {
    render(<ChatPanel transport={new MockTransport({ delays: instant, failConnect: true })} />);
    expect(await screen.findByRole('alert')).toHaveTextContent(/conectar/i);
    expect(liveRoles()).toEqual(['log', 'alert']);
    expect(activityAnnouncer()).toHaveTextContent('');
    expect(activityBadge()).toHaveTextContent('Erro');
  });
});

describe('ChatPanel no mobile', () => {
  afterEach(() => {
    stubDesktopMatchMedia();
  });

  it('move o foco para o campo ao abrir o chat e devolve ao item ao voltar', async () => {
    stubMobileMatchMedia();
    const user = userEvent.setup();
    render(<ChatPanel transport={new MockTransport({ delays: instant })} />);
    await waitFor(() => {
      expect(screen.getByLabelText('Lista de conversas')).toBeInTheDocument();
    });
    const liveItem = screen.getByRole('button', { name: /Conversa de teste/ });
    liveItem.focus();
    await user.keyboard('{Enter}');
    await waitFor(() => {
      expect(document.querySelector('.chat-header')).toHaveFocus();
    });
    await user.click(screen.getByRole('button', { name: 'Voltar' }));
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Conversa de teste/ })).toHaveFocus();
    });
  });

  it('ao voltar no mobile, seleção e foco ficam no item de origem', async () => {
    stubMobileMatchMedia();
    const user = userEvent.setup();
    render(<ChatPanel transport={new MockTransport({ delays: instant })} />);
    const liveItem = screen.getByRole('button', { name: /Conversa de teste/ });
    liveItem.focus();
    await user.keyboard('{Enter}');
    await waitFor(() => {
      expect(document.querySelector('.chat-header')).toHaveFocus();
    });
    await user.click(screen.getByRole('button', { name: 'Voltar' }));
    await waitFor(() => {
      expect(liveItem).toHaveFocus();
    });
    expect(liveItem).toHaveAttribute('aria-current', 'true');
  });

  it('na lista, a mensagem que chega com o chat oculto vira nova mensagem', async () => {
    stubMobileMatchMedia();
    const user = userEvent.setup();
    const transport = new ScriptedTransport();
    render(<ChatPanel transport={transport} />);
    await waitFor(() => {
      expect(transport.getStatus()).toBe('connected');
    });
    const conversationId = transport.lastSession?.conversationId ?? 'conv-web';
    await user.click(screen.getByRole('button', { name: /Conversa de teste/ }));
    await readyComposer();
    await user.click(screen.getByRole('button', { name: 'Voltar' }));
    act(() => {
      transport.emit({
        type: 'message',
        message: incomingText(conversationId, 'reply-on-list', 'Olá da equipe'),
      });
    });
    await waitFor(() => {
      expect(activityBadge()).toHaveTextContent('Nova mensagem');
    });
    expect(activityAnnouncer()).toHaveTextContent('Nova mensagem');
    expect(politeAnnouncements()).toHaveLength(1);
    await user.click(screen.getByRole('button', { name: /Conversa de teste/ }));
    await waitFor(() => {
      expect(document.querySelector('.live-activity-badge.is-unseen')).toBeNull();
    });
    expect(activityAnnouncer()).toHaveTextContent('');
  });

  it('mantém a região aria-live montada vazia e só muda o texto no mesmo nó', async () => {
    stubMobileMatchMedia();
    const user = userEvent.setup();
    const transport = new ScriptedTransport();
    render(<ChatPanel transport={transport} />);
    const announcer = activityAnnouncer();
    expect(announcer).toHaveAttribute('aria-live', 'polite');
    expect(announcer).toHaveTextContent('');
    await waitFor(() => {
      expect(transport.getStatus()).toBe('connected');
    });
    const conversationId = transport.lastSession?.conversationId ?? 'conversa-teste';
    await user.click(screen.getByRole('button', { name: /Conversa de teste/ }));
    await user.click(await screen.findByRole('button', { name: 'Voltar' }));
    act(() => {
      transport.emit({
        type: 'message',
        message: incomingText(conversationId, 'same-node', 'oi'),
      });
    });
    await waitFor(() => {
      expect(activityAnnouncer()).toHaveTextContent('Nova mensagem');
    });
    expect(activityAnnouncer()).toBe(announcer);
    await user.click(screen.getByRole('button', { name: /Conversa de teste/ }));
    await waitFor(() => {
      expect(activityAnnouncer()).toHaveTextContent('');
    });
    expect(activityAnnouncer()).toBe(announcer);
  });

  it('depois do remount na lista, mensagem nova fica não vista', async () => {
    stubMobileMatchMedia();
    window.history.replaceState({ smPane: 'list', conversationId: 'conversa-teste' }, '');
    const transport = new ScriptedTransport();
    render(<ChatPanel transport={transport} />);
    await waitFor(() => {
      expect(transport.getStatus()).toBe('connected');
    });
    const conversationId = transport.lastSession?.conversationId ?? 'conversa-teste';
    expect(document.querySelector('.live-activity-badge')).toBeNull();
    act(() => {
      transport.emit({
        type: 'message',
        message: incomingText(conversationId, 'after-reload', 'chegou'),
      });
    });
    await waitFor(() => {
      expect(activityBadge()).toHaveTextContent('Nova mensagem');
    });
    expect(screen.getByRole('button', { name: /Conversa de teste/ })).toHaveAccessibleName(/nova mensagem/i);
  });

  it('na lista indica envio em andamento ao voltar da conversa', async () => {
    stubMobileMatchMedia();
    const user = userEvent.setup();
    const transport = new ScriptedTransport();
    transport.holdSend = true;
    render(<ChatPanel transport={transport} />);
    await waitFor(() => {
      expect(transport.getStatus()).toBe('connected');
    });
    await user.click(screen.getByRole('button', { name: /Conversa de teste/ }));
    const field = await readyComposer();
    await user.type(field, 'oi');
    await user.click(screen.getByRole('button', { name: 'Enviar' }));
    await user.click(screen.getByRole('button', { name: 'Voltar' }));
    await waitFor(() => {
      expect(activityBadge()).toHaveTextContent('Enviando…');
    });
    expect(screen.getByRole('button', { name: /Conversa de teste/ })).toHaveAccessibleName(/enviando/i);
  });

  it('restaura a conversa selecionada a partir do history.state no remount', async () => {
    stubMobileMatchMedia();
    window.history.replaceState({ smPane: 'chat', conversationId: 'conversa-teste' }, '');
    const first = render(<ChatPanel transport={new MockTransport({ delays: instant })} />);
    await readyComposer();
    expect(screen.getByRole('button', { name: 'Voltar' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Conversa de teste/ })).toHaveAttribute('aria-current', 'true');
    first.unmount();
    render(<ChatPanel transport={new MockTransport({ delays: instant })} />);
    await readyComposer();
    expect(screen.getByRole('button', { name: 'Voltar' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Conversa de teste/ })).toHaveAttribute('aria-current', 'true');
  });

  it('se o item de origem sumiu da lista, o foco volta para a busca', async () => {
    stubMobileMatchMedia();
    const user = userEvent.setup();
    render(<ChatPanel transport={new MockTransport({ delays: instant })} />);
    await user.click(screen.getByRole('button', { name: /Conversa de teste/ }));
    await waitFor(() => {
      expect(document.querySelector('.chat-header')).toHaveFocus();
    });
    await user.type(screen.getByRole('searchbox', { name: 'Pesquisar conversa' }), 'zzzz-inexistente');
    expect(screen.queryByRole('button', { name: /Conversa de teste/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Voltar' }));
    await waitFor(() => {
      expect(screen.getByRole('searchbox', { name: 'Pesquisar conversa' })).toHaveFocus();
    });
  });

  it('na lista indica erro e reconexão da sessão ao vivo', async () => {
    stubMobileMatchMedia();
    const transport = new ScriptedTransport();
    render(<ChatPanel transport={transport} />);
    await waitFor(() => {
      expect(transport.getStatus()).toBe('connected');
    });
    act(() => {
      transport.emit({ type: 'connection', status: 'connecting' });
    });
    expect(screen.getByRole('button', { name: /Conversa de teste/ })).toHaveAccessibleName(/reconectando/i);
    expect(activityBadge()).toHaveTextContent('Reconectando');
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
        objectUrls={urls}
      />,
    );
    await readyComposer();
    await user.upload(fileInput(), new File([new Uint8Array(12)], 'foto.png', { type: 'image/png' }));
    expect(screen.getByRole('region', { name: 'Pré-visualização do anexo' })).toBeInTheDocument();
    expect(screen.queryByRole('log', { name: 'Mensagens' })).not.toBeInTheDocument();
    await user.type(screen.getByLabelText('Legenda'), 'minha foto');
    await user.click(screen.getByRole('button', { name: 'Enviar' }));
    expect(await thread().findByText('minha foto')).toBeInTheDocument();
    expect(thread().getByRole('img', { name: 'minha foto' })).toBeVisible();
    await waitFor(() => {
      expect(screen.getByLabelText('Lida')).toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: /Conversa de teste/ })).toHaveTextContent('minha foto');
  });

  it('arquivo inválido mostra alerta e Fechar remove', async () => {
    const user = userEvent.setup();
    render(<ChatPanel transport={new MockTransport({ delays: instant })} />);
    await readyComposer();
    fireEvent.change(fileInput(), {
      target: { files: [new File([new Uint8Array(8)], 'virus.exe', { type: 'application/octet-stream' })] },
    });
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/Formato não suportado: virus.exe/);
    await user.click(screen.getByRole('button', { name: 'Fechar' }));
    expect(screen.queryByText(/Formato não suportado/)).not.toBeInTheDocument();
  });

  it('depois de Enviar no preview o foco volta para Anexar arquivo', async () => {
    const user = userEvent.setup();
    const urls = createFakeObjectUrls();
    render(
      <ChatPanel
        transport={new MockTransport({ delays: { ...instant, uploadChunkMs: 0 }, objectUrls: urls })}
        objectUrls={urls}
      />,
    );
    await readyComposer();
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
    render(<ChatPanel transport={transport} objectUrls={urls} />);
    await readyComposer();
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
    render(<ChatPanel transport={transport} objectUrls={urls} />);
    await readyComposer();
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
    render(<ChatPanel transport={transport} objectUrls={urls} />);
    await readyComposer();
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
        objectUrls={urls}
      />,
    );
    await readyComposer();
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
    render(<ChatPanel transport={transport} objectUrls={urls} />);
    await readyComposer();
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
    render(<ChatPanel transport={transport} objectUrls={urls} />);
    await readyComposer();
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

  it('falha de upload aparece na atividade ao voltar à lista no mobile', async () => {
    stubMobileMatchMedia();
    const user = userEvent.setup();
    const urls = createFakeObjectUrls();
    const transport = new ScriptedTransport();
    transport.failUpload = true;
    render(<ChatPanel transport={transport} objectUrls={urls} />);
    await user.click(screen.getByRole('button', { name: /Conversa de teste/ }));
    await readyComposer();
    await user.upload(fileInput(), png());
    await user.click(screen.getByRole('button', { name: 'Enviar' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/Falha ao enviar exame.png/);
    await user.click(screen.getByRole('button', { name: 'Voltar' }));
    expect(screen.getByRole('button', { name: /Conversa de teste/ })).toHaveAccessibleName(/erro/i);
    expect(activityBadge()).toHaveTextContent('Erro');
    expect(activityAnnouncer()).toHaveTextContent('Erro');
    stubDesktopMatchMedia();
  });

  it('progresso do upload não rouba o foco de Baixar foto', async () => {
    const user = userEvent.setup();
    const urls = createFakeObjectUrls();
    const transport = new ScriptedTransport();
    transport.holdUpload = true;
    render(<ChatPanel transport={transport} objectUrls={urls} />);
    await readyComposer();
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
    render(<ChatPanel transport={transport} objectUrls={urls} />);
    await readyComposer();
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

  it('cancelar o upload com o visualizador aberto devolve o foco a um destino válido', async () => {
    const user = userEvent.setup();
    const urls = createFakeObjectUrls();
    const transport = new ScriptedTransport();
    transport.holdUpload = true;
    render(<ChatPanel transport={transport} objectUrls={urls} />);
    await readyComposer();
    await user.upload(fileInput(), png());
    await user.click(screen.getByRole('button', { name: 'Enviar' }));
    await user.click(await screen.findByRole('button', { name: 'Abrir foto em tela cheia' }));
    expect(screen.getByRole('button', { name: 'Fechar foto' })).toHaveFocus();
    await user.click(screen.getByRole('button', { name: 'Cancelar envio de exame.png' }));
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'Fechar foto' })).not.toBeInTheDocument();
      expect(document.activeElement).not.toBe(document.body);
    });
    const focused = document.activeElement;
    expect(
      focused === document.querySelector('.chat-header') ||
        focused?.getAttribute('aria-label') === 'Anexar arquivo' ||
        focused?.getAttribute('aria-label') === 'Mensagem',
    ).toBe(true);
  });
});
