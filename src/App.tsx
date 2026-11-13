import { useState } from 'react';
import type { ChatTransport } from './transport/ChatTransport';
import { historyConversationId } from './ui/chatHistory';
import { ChatPanel } from './ui/ChatPanel';
import { LIVE_CONVERSATION_ID } from './ui/conversations';

export function App({ transport }: { transport: ChatTransport }) {
  const [selectedConversationId, setSelectedConversationId] = useState(
    () => historyConversationId(window.history.state) ?? LIVE_CONVERSATION_ID,
  );

  return (
    <main className="page-shell">
      <ChatPanel
        transport={transport}
        selectedConversationId={selectedConversationId}
        onSelectConversation={setSelectedConversationId}
      />
    </main>
  );
}
