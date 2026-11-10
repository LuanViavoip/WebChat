import { useState } from 'react';
import type { ChatTransport } from '../transport/ChatTransport';
import { ChatPanel } from './ChatPanel';

export function ChatWidget({
  transport,
  patientName,
}: {
  transport: ChatTransport;
  patientName: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="widget-root">
      {open ? (
        <div className="widget-frame">
          <ChatPanel
            transport={transport}
            patientName={patientName}
            onClose={() => {
              setOpen(false);
            }}
          />
        </div>
      ) : null}
      <button
        type="button"
        className="widget-fab"
        aria-label={open ? 'Chat aberto' : 'Abrir chat de atendimento'}
        onClick={() => {
          setOpen(true);
        }}
      >
        Chat ICS
      </button>
    </div>
  );
}
