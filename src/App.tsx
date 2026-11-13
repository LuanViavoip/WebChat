import { useState } from 'react';
import type { ChatTransport } from './transport/ChatTransport';
import { historyConversationId } from './ui/chatHistory';
import { ChatPanel } from './ui/ChatPanel';
import { ChatWidget } from './ui/ChatWidget';
import { LIVE_CONVERSATION_ID } from './ui/conversations';

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
  const [selectedConversationId, setSelectedConversationId] = useState(
    () => historyConversationId(window.history.state) ?? LIVE_CONVERSATION_ID,
  );

  if (mode === 'widget') {
    return (
      <div className="host-page">
        <header className="host-header">Instituto Curitiba de Saúde</header>
        <HostPortal />
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

function HostPortal() {
  const [received, setReceived] = useState<string | null>(null);

  function receive(files: FileList | File[] | null | undefined) {
    const file = files?.[0];
    if (!file) {
      return;
    }
    setReceived(file.name);
  }

  return (
    <main className="host-main">
      <h2>Portal do paciente (exemplo)</h2>
      <p>
        O ChatWeb pode ser embutido como widget flutuante nesta página. Use o botão no canto
        inferior direito para abrir o atendimento.
      </p>
      <label className="host-file">
        Anexo do portal
        <input
          type="file"
          aria-label="Anexo do portal"
          onChange={(event) => {
            receive(event.currentTarget.files);
          }}
        />
      </label>
      <div
        className="host-drop"
        onDragOver={(event) => {
          if (!event.dataTransfer.types.includes('Files')) {
            return;
          }
          event.preventDefault();
        }}
        onDrop={(event) => {
          if (!event.dataTransfer.types.includes('Files')) {
            return;
          }
          event.preventDefault();
          receive(event.dataTransfer.files);
        }}
      >
        {received ? `Portal recebeu ${received}` : 'Solte um arquivo no portal'}
      </div>
    </main>
  );
}
