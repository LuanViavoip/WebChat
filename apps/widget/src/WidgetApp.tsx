import {
  conversationAckSchema,
  conversationSnapshotAckSchema,
  conversationSummarySchema,
  historySyncAckSchema,
  messageRecordSchema,
  messageSendAckSchema,
  parentOriginFromReferrer,
  parentToWidgetSchema,
  queuePositionSchema,
  surveyRequiredSchema,
  WIDGET_SOURCE,
  type ConversationSummary,
  type MessageRecord,
  type QueueSummary,
  type SurveyPrompt,
  type WidgetSettings,
} from '@viavoip/protocol';
import { panelSize } from './panel-size.js';
import { useEffect, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import { createVisitorSession, fetchPublicWidget, resumeVisitor } from './api.js';

const tokenKey = 'viavoip.visitorToken';
const conversationKey = 'viavoip.conversationId';

type Phase = 'loading' | 'error' | 'queues' | 'chat' | 'survey' | 'closed';

export function WidgetApp() {
  const sitePublicId = new URLSearchParams(window.location.search).get('site') ?? '';
  const embedded = window.parent !== window;
  // Embutido, o widget nasce como botão: o iframe só cresce depois que a origem do site é validada.
  const [panelOpen, setPanelOpen] = useState(!embedded);
  const [phase, setPhase] = useState<Phase>('loading');
  const [error, setError] = useState('');
  const [queues, setQueues] = useState<QueueSummary[]>([]);
  const [settings, setSettings] = useState<WidgetSettings | null>(null);
  const [allowedOrigins, setAllowedOrigins] = useState<string[]>([]);
  const [parentOrigin, setParentOrigin] = useState<string | null>(null);
  const [conversation, setConversation] = useState<ConversationSummary | null>(null);
  const [messages, setMessages] = useState<MessageRecord[]>([]);
  const [survey, setSurvey] = useState<SurveyPrompt | null>(null);
  const [position, setPosition] = useState<number | null>(null);
  const [displayName, setDisplayName] = useState('');
  const [draft, setDraft] = useState('');
  const [comment, setComment] = useState('');
  const [score, setScore] = useState(5);
  const socketRef = useRef<Socket | null>(null);
  const conversationRef = useRef<string | null>(null);
  const afterMessageRef = useRef<string | undefined>(undefined);
  const afterEventRef = useRef<string | undefined>(undefined);
  const listRef = useRef<HTMLDivElement | null>(null);
  const launcherRef = useRef<HTMLButtonElement | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const firstControlRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    conversationRef.current = conversation?.id ?? null;
    if (conversation?.id) sessionStorage.setItem(conversationKey, conversation.id);
  }, [conversation]);

  useEffect(() => {
    if (!settings) return;
    if (/^#[0-9a-fA-F]{6}$/.test(settings.primaryColor)) {
      document.documentElement.style.setProperty('--brand', settings.primaryColor);
    }
  }, [settings]);

  // Com origem validada, avisa o site. Sem ela, nada é enviado e o iframe fica do tamanho do botão.
  useEffect(() => {
    if (!embedded || !parentOrigin) return;
    window.parent.postMessage({ source: WIDGET_SOURCE, type: 'ready' }, parentOrigin);
  }, [embedded, parentOrigin]);

  useEffect(() => {
    if (!embedded || !parentOrigin) return;
    const frame = panelSize(panelOpen);
    window.parent.postMessage({ source: WIDGET_SOURCE, type: panelOpen ? 'open' : 'close' }, parentOrigin);
    // Tamanho nominal, só para loaders antigos: o loader atual calcula a geometria pelo viewport do site.
    window.parent.postMessage({ source: WIDGET_SOURCE, type: 'resize', width: frame.width, height: frame.height }, parentOrigin);
  }, [embedded, panelOpen, parentOrigin]);

  useEffect(() => {
    if (!embedded) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && panelOpen) setPanelOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [embedded, panelOpen]);

  // O foco só volta ao botão depois de o painel ter sido aberto: ao carregar, o widget não rouba o foco do site.
  const openedOnce = useRef(false);
  useEffect(() => {
    if (!embedded) return;
    if (!panelOpen) {
      if (openedOnce.current) launcherRef.current?.focus();
      return;
    }
    openedOnce.current = true;
    (firstControlRef.current ?? closeRef.current)?.focus();
  }, [embedded, panelOpen, phase]);

  useEffect(() => {
    if (!sitePublicId) {
      setPhase('error');
      setError('O script do webchat precisa do identificador público do site.');
      return;
    }
    let disposed = false;
    const socket = io('/visitor', {
      autoConnect: false,
      transports: ['websocket'],
      withCredentials: false,
    });
    socketRef.current = socket;

    const applySnapshot = (snapshot: {
      conversation: ConversationSummary;
      messages: MessageRecord[];
      survey: SurveyPrompt | null;
      events?: { id: string }[];
    }) => {
      conversationRef.current = snapshot.conversation.id;
      setConversation(snapshot.conversation);
      setMessages((current) => {
        const merged = mergeMessages(snapshot.messages, current);
        const last = merged.at(-1);
        if (last) afterMessageRef.current = last.id;
        return merged;
      });
      const lastEvent = snapshot.events?.at(-1);
      if (lastEvent) afterEventRef.current = lastEvent.id;
      if (snapshot.conversation.status !== 'queued') setPosition(null);
      setSurvey(snapshot.survey);
      setPhase(phaseFor(snapshot.conversation.status));
    };

    socket.on('connect', () => {
      const currentId = conversationRef.current ?? sessionStorage.getItem(conversationKey);
      if (!currentId) return;
      const payload: { conversationId: string; afterMessageId?: string; afterEventId?: string } = {
        conversationId: currentId,
      };
      if (afterMessageRef.current) payload.afterMessageId = afterMessageRef.current;
      if (afterEventRef.current) payload.afterEventId = afterEventRef.current;
      socket.emit('history.sync', payload, (ack: unknown) => {
        const parsed = historySyncAckSchema.safeParse(ack);
        if (!parsed.success || !parsed.data.ok) return;
        applySnapshot(parsed.data);
      });
    });
    socket.on('message.new', (payload: unknown) => {
      const parsed = messageRecordSchema.safeParse(payload);
      if (!parsed.success || parsed.data.conversationId !== conversationRef.current) return;
      setMessages((current) => mergeMessages(current, [parsed.data]));
    });
    socket.on('conversation.updated', (payload: unknown) => {
      const parsed = conversationSummarySchema.safeParse(payload);
      if (!parsed.success || parsed.data.id !== conversationRef.current) return;
      setConversation(parsed.data);
      if (parsed.data.status !== 'queued') setPosition(null);
      setPhase(phaseFor(parsed.data.status));
    });
    socket.on('queue.position', (payload: unknown) => {
      const parsed = queuePositionSchema.safeParse(payload);
      if (!parsed.success || parsed.data.conversationId !== conversationRef.current) return;
      setPosition(parsed.data.position);
    });
    socket.on('survey.required', (payload: unknown) => {
      const parsed = surveyRequiredSchema.safeParse(payload);
      if (!parsed.success || parsed.data.conversationId !== conversationRef.current) return;
      setSurvey(parsed.data.survey);
      setPhase('survey');
    });

    const boot = async () => {
      try {
        const config = await fetchPublicWidget(sitePublicId);
        if (disposed) return;
        const parent = authorizedParent(config.allowedOrigins, embedded);
        if (!parent) throw new Error('Este site não está autorizado a usar o webchat.');
        // A origem validada vale antes de qualquer chamada de rede seguinte: um erro de sessão
        // ainda pode ser mostrado no painel, e é a única origem para a qual postamos.
        setParentOrigin(parent);
        let token = sessionStorage.getItem(tokenKey) ?? '';
        let nextQueues = config.queues;
        let nextSettings: WidgetSettings = config;
        if (token) {
          try {
            const context = await resumeVisitor(token);
            nextQueues = context.queues;
            nextSettings = context;
          } catch {
            token = '';
          }
        }
        if (!token) {
          const created = await createVisitorSession(sitePublicId, parent);
          token = created.token;
          sessionStorage.setItem(tokenKey, token);
          nextQueues = created.queues;
          nextSettings = created;
        }
        if (disposed) return;
        setQueues(nextQueues);
        setSettings(nextSettings);
        setAllowedOrigins(nextSettings.allowedOrigins);
        const storedConversation = sessionStorage.getItem(conversationKey);
        if (storedConversation) conversationRef.current = storedConversation;
        else setPhase('queues');
        socket.auth = { token };
        socket.connect();
      } catch (cause) {
        if (disposed) return;
        setPhase('error');
        setError(cause instanceof Error ? cause.message : 'Falha ao abrir o webchat');
      }
    };
    void boot();
    return () => {
      disposed = true;
      socket.disconnect();
      socketRef.current = null;
    };
  }, [sitePublicId]);

  useEffect(() => {
    function onMessage(event: MessageEvent) {
      if (!embedded || event.source !== window.parent || event.origin !== parentOrigin) return;
      const parsed = parentToWidgetSchema.safeParse(event.data);
      if (!parsed.success) return;
      switch (parsed.data.type) {
        case 'open':
          setPanelOpen(true);
          return;
        case 'close':
          setPanelOpen(false);
          return;
        default: {
          const neverType: never = parsed.data;
          throw new Error(`Mensagem inesperada: ${String(neverType)}`);
        }
      }
    }
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [embedded, parentOrigin]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages, phase]);

  async function startQueue(queueId: string) {
    const socket = socketRef.current;
    if (!socket) return;
    const parsed = conversationSnapshotAckSchema.safeParse(
      await emit(socket, 'conversation.start', {
        queueId,
        ...(displayName.trim() ? { displayName: displayName.trim() } : {}),
      }),
    );
    if (!parsed.success) {
      setError('Não foi possível entrar na fila');
      return;
    }
    if (!parsed.data.ok) {
      setError(parsed.data.error.message);
      return;
    }
    conversationRef.current = parsed.data.conversation.id;
    setConversation(parsed.data.conversation);
    setMessages(parsed.data.messages);
    setSurvey(parsed.data.survey);
    setPhase(phaseFor(parsed.data.conversation.status));
  }

  async function leaveQueue() {
    const socket = socketRef.current;
    if (!socket || !conversation) return;
    const parsed = conversationAckSchema.safeParse(
      await emit(socket, 'conversation.leave', { conversationId: conversation.id }),
    );
    if (!parsed.success || !parsed.data.ok) {
      setError(parsed.success && !parsed.data.ok ? parsed.data.error.message : 'Não foi possível sair da fila');
      return;
    }
    conversationRef.current = null;
    sessionStorage.removeItem(conversationKey);
    setConversation(null);
    setMessages([]);
    setPosition(null);
    setPhase('queues');
  }

  async function sendMessage() {
    const socket = socketRef.current;
    const conversationId = conversation?.id;
    const body = draft.trim();
    if (!socket || !conversationId || !body) return;
    const requestId = crypto.randomUUID();
    setDraft('');
    const parsed = messageSendAckSchema.safeParse(
      await emit(socket, 'message.send', { conversationId, requestId, body }),
    );
    if (!parsed.success) {
      setDraft(body);
      setError('Mensagem recusada');
      return;
    }
    if (!parsed.data.ok) {
      setDraft(body);
      setError(parsed.data.error.message);
    }
  }

  async function submitSurvey() {
    const socket = socketRef.current;
    if (!socket || !conversation) return;
    const ack = asRecord(
      await emit(socket, 'survey.submit', {
        conversationId: conversation.id,
        score,
        ...(comment.trim() ? { comment: comment.trim() } : {}),
      }),
    );
    if (ack.ok !== true) {
      const message =
        ack.error && typeof ack.error === 'object' && 'message' in ack.error
          ? String(ack.error.message)
          : 'Pesquisa recusada';
      setError(message);
      return;
    }
    const parsed = conversationSummarySchema.safeParse(ack.conversation);
    if (parsed.success) setConversation(parsed.data);
    setPhase('closed');
  }

  const nameRequired = settings?.requireVisitorName === true;
  const nameMissing = nameRequired && displayName.trim().length === 0;
  const closedForNew = settings?.acceptingChats === false && phase === 'queues';

  if (embedded && !panelOpen) {
    // Sem origem validada o iframe não pode crescer: o botão fica inerte em vez de abrir o painel dentro dele.
    const available = parentOrigin !== null;
    return (
      <div className="launcher-frame">
        <button
          ref={launcherRef}
          className="launcher"
          type="button"
          data-testid="launcher"
          aria-label={available ? 'Abrir atendimento' : 'Atendimento indisponível neste site'}
          aria-expanded={false}
          aria-controls="webchat-panel"
          disabled={!available}
          onClick={() => setPanelOpen(true)}
        >
          <svg viewBox="0 0 24 24" width="28" height="28" aria-hidden="true" focusable="false">
            <path
              fill="currentColor"
              d="M4 4h16a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H9l-4.3 3.6A.8.8 0 0 1 3.4 20V17.4A2 2 0 0 1 2 15.5V6a2 2 0 0 1 2-2Z"
            />
          </svg>
          <span className="sr-only">Chat</span>
        </button>
      </div>
    );
  }

  return (
    <main
      id="webchat-panel"
      className={embedded ? 'panel' : 'panel standalone'}
      role={embedded ? 'dialog' : undefined}
      aria-modal={embedded ? true : undefined}
      aria-labelledby="webchat-title"
    >
      <header className="panel__head">
        <div>
          {settings?.logoUrl?.startsWith('https://') ? (
            <img className="logo" src={settings.logoUrl} alt="" />
          ) : (
            <p className="eyebrow">ViaVoip</p>
          )}
          <h1 id="webchat-title">{settings?.siteName ?? 'Atendimento'}</h1>
        </div>
        {embedded ? (
          <button ref={closeRef} type="button" onClick={() => setPanelOpen(false)} aria-label="Fechar atendimento">
            Fechar
          </button>
        ) : null}
      </header>
      <div className="panel__body">
        {error ? <p className="error" role="alert">{error}</p> : null}
        {phase === 'loading' ? <p className="muted">Conectando…</p> : null}
        {closedForNew ? (
          <p data-testid="unavailable">{settings?.welcomeMessage} O atendimento está fechado no momento.</p>
        ) : null}
        {phase === 'queues' && !closedForNew ? (
          <section data-testid="queue-list">
            <p>{settings?.welcomeMessage ?? 'Escolha uma fila para começar.'}</p>
            {nameRequired ? (
              <label>
                Seu nome
                <input
                  ref={(node) => {
                    firstControlRef.current = node;
                  }}
                  data-testid="visitor-name"
                  value={displayName}
                  onChange={(event) => setDisplayName(event.target.value)}
                  maxLength={80}
                  required
                />
              </label>
            ) : null}
            <div className="stack">
              {queues.map((queue, index) => (
                <button
                  key={queue.id}
                  ref={
                    nameRequired || index > 0
                      ? undefined
                      : (node) => {
                          firstControlRef.current = node;
                        }
                  }
                  type="button"
                  data-testid="queue-option"
                  disabled={nameMissing}
                  onClick={() => void startQueue(queue.id)}
                >
                  {queue.name}
                </button>
              ))}
            </div>
          </section>
        ) : null}
        {phase === 'chat' && conversation ? (
          <section className="chat">
            <p className="muted">
              {conversation.queueName} · {label(conversation.status)}
              {conversation.status === 'queued' && position ? ` · Posição ${position}` : ''}
            </p>
            {conversation.status === 'queued' ? (
              <button data-testid="leave" type="button" onClick={() => void leaveQueue()}>
                Sair da fila
              </button>
            ) : null}
            <div className="messages" ref={listRef}>
              {messages.map((message) => (
                <article key={message.id} data-testid="message" className={message.senderType}>
                  <p>{message.body}</p>
                </article>
              ))}
            </div>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void sendMessage();
              }}
            >
              <input
                data-testid="composer"
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                placeholder="Escreva sua mensagem"
                maxLength={4000}
              />
              <button data-testid="send" type="submit">
                Enviar
              </button>
            </form>
          </section>
        ) : null}
        {phase === 'survey' && survey ? (
          <form
            className="stack"
            data-testid="survey"
            onSubmit={(event) => {
              event.preventDefault();
              void submitSurvey();
            }}
          >
            <p>{survey.prompt}</p>
            <div className="scores">
              {Array.from({ length: survey.scale }, (_, index) => index + 1).map((value) => (
                <button
                  key={value}
                  type="button"
                  className={value === score ? 'selected' : ''}
                  onClick={() => setScore(value)}
                >
                  {value}
                </button>
              ))}
            </div>
            {survey.commentEnabled ? (
              <textarea
                value={comment}
                onChange={(event) => setComment(event.target.value)}
                placeholder="Comentário opcional"
              />
            ) : null}
            <button type="submit">Enviar avaliação</button>
          </form>
        ) : null}
        {phase === 'closed' ? <p data-testid="closed" className="notice">Atendimento encerrado. Obrigado pela avaliação.</p> : null}
      </div>
    </main>
  );
}

function authorizedParent(allowedOrigins: string[], embedded: boolean): string | null {
  const fromReferrer = parentOriginFromReferrer(document.referrer, allowedOrigins);
  if (fromReferrer) return fromReferrer;
  if (!embedded && allowedOrigins.includes(window.location.origin)) return window.location.origin;
  return null;
}

function emit(socket: Socket, event: string, payload: unknown): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), 8000);
    socket.emit(event, payload, (response: unknown) => {
      clearTimeout(timer);
      resolve(response);
    });
  });
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function phaseFor(status: ConversationSummary['status']): Phase {
  switch (status) {
    case 'queued':
    case 'assigned':
      return 'chat';
    case 'awaiting_survey':
      return 'survey';
    case 'closed':
      return 'closed';
    default: {
      const neverStatus: never = status;
      return neverStatus;
    }
  }
}

function label(status: ConversationSummary['status']): string {
  switch (status) {
    case 'queued':
      return 'Aguardando atendente';
    case 'assigned':
      return 'Em atendimento';
    case 'awaiting_survey':
      return 'Pesquisa';
    case 'closed':
      return 'Encerrada';
    default: {
      const neverStatus: never = status;
      return neverStatus;
    }
  }
}

function mergeMessages(primary: MessageRecord[], extra: MessageRecord[]): MessageRecord[] {
  const byId = new Map<string, MessageRecord>();
  for (const message of [...primary, ...extra]) byId.set(message.id, message);
  return [...byId.values()].sort(
    (left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id),
  );
}
