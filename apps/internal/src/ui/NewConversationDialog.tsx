import { X } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef } from 'react';
import type { StaffUser } from '@viavoip/internal-domain';
import { conversationInitials, roleLabel } from './conversations';

/**
 * Seletor de colega. Quem chega aqui já foi filtrado por `can(me, direct.open)`; o diálogo só desenha.
 * Esc e "Fechar" fecham; quem abre devolve o foco.
 */
export function NewConversationDialog({
  open,
  candidates,
  onPick,
  onClose,
}: {
  open: boolean;
  candidates: readonly StaffUser[];
  onPick: (user: StaffUser) => void;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) {
      return;
    }
    if (open) {
      if (!dialog.open) {
        dialog.showModal();
        const first = dialog.querySelector<HTMLElement>('.new-conversation-user');
        (first ?? closeRef.current)?.focus();
      }
      return;
    }
    if (dialog.open) {
      dialog.close();
    }
  }, [open]);

  useEffect(() => {
    if (!open) {
      return;
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, [open, onClose]);

  return (
    <dialog
      ref={dialogRef}
      className="new-conversation"
      aria-labelledby="new-conversation-title"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      {open ? (
        <>
          <div className="new-conversation-bar">
            <h2 id="new-conversation-title" className="new-conversation-title">
              Nova conversa
            </h2>
            <button
              ref={closeRef}
              type="button"
              className="icon-button"
              aria-label="Fechar"
              onClick={onClose}
            >
              <X size={20} strokeWidth={1.8} aria-hidden="true" />
            </button>
          </div>
          {candidates.length === 0 ? (
            <p className="conversation-empty">Nenhum colega disponível para conversar.</p>
          ) : (
            <ul className="new-conversation-list">
              {candidates.map((user) => (
                <li key={user.id}>
                  <button
                    type="button"
                    className="new-conversation-user"
                    onClick={() => {
                      onPick(user);
                    }}
                  >
                    <span className="avatar avatar-contact" aria-hidden="true">
                      {conversationInitials(user.name)}
                    </span>
                    <span className="new-conversation-copy">
                      <span className="conversation-title">{user.name}</span>
                      <span className="conversation-preview">{roleLabel(user.role)}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      ) : null}
    </dialog>
  );
}
