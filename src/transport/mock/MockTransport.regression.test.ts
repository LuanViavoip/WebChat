import { ChatSession } from '../../chat/ChatSession';
import { createFakeObjectUrls } from '../../test/fakeObjectUrls';
import { SessionAbortedError } from '../abort';
import type { ConnectRequest } from '../ChatTransport';
import { MockTransport } from './MockTransport';
import { DEFAULT_SESSION, ICS_USERS, LIVE_CONVERSATION_ID, OTHER_CONVERSATION_ID } from './seed';

const delays = { connectMs: 10, sentMs: 30, deliveredMs: 30, readMs: 30, uploadChunkMs: 0 };
const ME = DEFAULT_SESSION;
/** Outro usuário da mesma empresa: conectar como ele é "trocar de sessão". */
const OTHER: ConnectRequest = { tenantId: DEFAULT_SESSION.tenantId, userId: ICS_USERS.ana };
const file = () => new File(['x'], 'x.png', { type: 'image/png' });
const request = () => ({
  conversationId: LIVE_CONVERSATION_ID,
  clientId: 'up',
  file: file(),
  fileName: 'x.png',
  mimeType: 'image/png',
  signal: new AbortController().signal,
  onProgress: () => {},
});

describe('isolamento de operações entre sessões', () => {
  it.each([false, true])('não envia texto enfileirado à conversa nova (stop=%s)', async (stop) => {
    const transport = new MockTransport({ delays });
    const session = new ChatSession(transport, { createId: () => 'old' });
    const first = session.start(LIVE_CONVERSATION_ID);
    const sending = session.send({ type: 'text', text: 'oi' });
    if (stop) session.stop();
    const next = session.start(OTHER_CONVERSATION_ID);
    await Promise.all([first, sending, next]);
    await new Promise((resolve) => setTimeout(resolve, 140));
    expect(session.getState().messages.some((message) => message.clientId === 'old')).toBe(false);
    session.stop();
  });

  it.each([false, true])('aborta upload esperando conexão antes da troca (disconnect=%s)', async (stop) => {
    const urls = createFakeObjectUrls();
    const transport = new MockTransport({ delays, objectUrls: urls });
    const first = transport.connect(ME).catch(() => {});
    const upload = transport.upload(request());
    const rejected = expect(upload).rejects.toBeInstanceOf(SessionAbortedError);
    if (stop) transport.disconnect();
    const next = transport.connect(OTHER);
    await Promise.all([first, next, rejected]);
    expect(urls.created).toHaveLength(0);
    transport.disconnect();
  });

  it('aborta upload em andamento mesmo com reconnect imediato no mesmo ID', async () => {
    const urls = createFakeObjectUrls();
    const transport = new MockTransport({ delays, objectUrls: urls });
    await transport.connect(ME);
    const upload = transport.upload(request());
    const rejected = expect(upload).rejects.toBeInstanceOf(SessionAbortedError);
    transport.disconnect();
    await Promise.all([transport.connect(ME), rejected]);
    expect(urls.created).toHaveLength(0);
    transport.disconnect();
  });

  it('descarta envio e upload enfileirados após disconnect mesmo com o mesmo ID', async () => {
    const urls = createFakeObjectUrls();
    const transport = new MockTransport({ delays, objectUrls: urls });
    const events: string[] = [];
    transport.subscribe((event) => {
      if (event.type === 'message' && event.message.clientId) events.push(event.message.clientId);
    });
    const first = transport.connect(ME).catch(() => {});
    const send = transport.send({ conversationId: LIVE_CONVERSATION_ID, clientId: 'old', payload: { type: 'text', text: 'oi' } });
    const upload = transport.upload(request());
    const rejectedSend = expect(send).rejects.toBeInstanceOf(SessionAbortedError);
    const rejectedUpload = expect(upload).rejects.toBeInstanceOf(SessionAbortedError);
    transport.disconnect();
    await Promise.all([first, transport.connect(ME), rejectedSend, rejectedUpload]);
    expect(events).toEqual([]);
    expect(urls.created).toEqual([]);
    transport.disconnect();
  });

  it('ao reconectar texto em voo chega a lida sem retransmitir ou duplicar', async () => {
    const transport = new MockTransport({ simulateReceipts: true, delays });
    const session = new ChatSession(transport, { createId: () => 'msg-1' });
    const echoes: string[] = [];
    transport.subscribe((event) => {
      if (event.type === 'message' && event.message.clientId === 'msg-1') echoes.push(event.message.clientId);
    });
    await session.start(LIVE_CONVERSATION_ID);
    await session.send({ type: 'text', text: '1' });
    await transport.connect(ME);
    await new Promise((resolve) => setTimeout(resolve, 150));
    const sent = session.getState().messages.filter((message) => message.clientId === 'msg-1');
    expect(sent).toHaveLength(1);
    expect(sent[0]?.status).toBe('read');
    expect(echoes).toEqual(['msg-1']);
    session.stop();
  });

  it('não emite status antigo quando um ouvinte troca de conversa no eco', async () => {
    const transport = new MockTransport({ delays });
    const statuses: string[] = [];
    let switched: Promise<void> = Promise.resolve();
    transport.subscribe((event) => {
      if (event.type === 'message' && event.message.clientId === 'old') {
        switched = transport.connect(OTHER).then(() => {});
      }
      if (event.type === 'status' && event.clientId === 'old') statuses.push(event.status);
    });
    await transport.connect(ME);
    await transport.send({ conversationId: LIVE_CONVERSATION_ID, clientId: 'old', payload: { type: 'text', text: '1' } });
    await switched;
    await new Promise((resolve) => setTimeout(resolve, 140));
    expect(statuses).toEqual([]);
    transport.disconnect();
  });
});
