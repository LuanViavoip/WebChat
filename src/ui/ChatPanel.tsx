import type { ChatTransport } from '../transport/ChatTransport';
import { ChatHeader } from './ChatHeader';
import { Composer } from './Composer';
import { MenuBar } from './MenuBar';
import { MessageList } from './MessageList';
import { useChatSession } from './useChatSession';

export function ChatPanel({
  transport,
  patientName,
  onClose,
}: {
  transport: ChatTransport;
  patientName: string;
  onClose?: () => void;
}) {
  const { state, send, sendMenuOption } = useChatSession(transport, patientName);
  const disabled = state.connection !== 'connected';

  return (
    <section className="chat-panel" aria-label="Conversa com o ICS">
      <ChatHeader
        connection={state.connection}
        typing={state.typing}
        {...(onClose ? { onClose } : {})}
      />
      <MessageList messages={state.messages} typing={state.typing} />
      <MenuBar options={state.menu} onSelect={sendMenuOption} disabled={disabled} />
      <Composer onSend={send} disabled={disabled} />
    </section>
  );
}
