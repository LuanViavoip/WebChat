import { useState } from 'react';
import { ChatPanel } from './ui/ChatPanel';
import { ChatWidget } from './ui/ChatWidget';
import { LIVE_CONVERSATION_ID } from './ui/conversations';
import type { ChatTransport } from './transport/ChatTransport';

export type AppMode = 'page' | 'widget';

export function App({
  transport,
  patientName,
  mode,
}: {
  transport: ChatTransport;
  patientName: string;
  mode: AppMode;
}) {
  const [selectedConversationId, setSelectedConversationId] = useState(LIVE_CONVERSATION_ID);

  if (mode === 'widget') {
    return (
      <div className="host-page">
        <header className="host-header">Instituto Curitiba de Saúde</header>
        <main className="host-main">
          <h2>Portal do paciente (exemplo)</h2>
          <p>
            O ChatWeb pode ser embutido como widget flutuante nesta página. Use o botão no canto
            inferior direito para abrir o atendimento.
          </p>
        </main>
        <ChatWidget transport={transport} patientName={patientName} />
      </div>
    );
  }

  return (
    <main className="page-shell">
      <ChatPanel
        transport={transport}
        patientName={patientName}
        selectedConversationId={selectedConversationId}
        onSelectConversation={setSelectedConversationId}
      />
    </main>
  );
}
