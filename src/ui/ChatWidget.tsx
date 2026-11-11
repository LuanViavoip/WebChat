import { useEffect, useRef, useState } from 'react';
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
  const fabRef = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef(false);

  useEffect(() => {
    if (!open && returnFocus.current) {
      fabRef.current?.focus();
      returnFocus.current = false;
    }
  }, [open]);

  return (
    <div className="widget-root">
      {open ? (
        <div className="widget-frame">
          <ChatPanel
            transport={transport}
            patientName={patientName}
            compact
            onClose={() => {
              returnFocus.current = true;
              setOpen(false);
            }}
          />
        </div>
      ) : null}
      <button
        ref={fabRef}
        type="button"
        className="widget-fab"
        aria-label={open ? 'Chat ICS, aberto' : 'Abrir chat de atendimento'}
        onClick={() => {
          setOpen(true);
        }}
      >
        Chat ICS
      </button>
    </div>
  );
}
