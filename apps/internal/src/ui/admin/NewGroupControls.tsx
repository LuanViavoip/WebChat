import { Plus, X } from 'lucide-react';
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import type { Ilha } from '@viavoip/internal-domain';

/**
 * "Novo grupo" e o seletor de ilha. Só aparece para quem tem `group.manage` (quem monta decide, pelo
 * predicado do domínio, e a visibilidade acompanha o evento `grants`). A criação de verdade é da Etapa 6:
 * o botão abre um diálogo que diz isso e não cria nada.
 */
export function NewGroupControls({ ilhas }: { ilhas: readonly Ilha[] }) {
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState('');
  const buttonRef = useRef<HTMLButtonElement>(null);
  const selectId = useId();
  const chosen = ilhas.find((ilha) => ilha.id === picked);

  const close = useCallback(() => {
    setOpen(false);
    requestAnimationFrame(() => {
      buttonRef.current?.focus();
    });
  }, []);

  return (
    <div className="sidebar-groups" role="group" aria-label="Grupos">
      <div className="admin-field sidebar-groups-select">
        <label htmlFor={selectId}>Ilha do grupo</label>
        <select
          id={selectId}
          value={chosen?.id ?? ''}
          onChange={(event) => {
            setPicked(event.target.value);
          }}
        >
          <option value="">Sem ilha</option>
          {ilhas.map((ilha) => (
            <option key={ilha.id} value={ilha.id}>
              {ilha.name}
            </option>
          ))}
        </select>
      </div>
      <button
        ref={buttonRef}
        type="button"
        className="admin-new sidebar-groups-new"
        onClick={() => {
          setOpen(true);
        }}
      >
        <Plus size={16} strokeWidth={2} aria-hidden="true" />
        Novo grupo
      </button>
      <NewGroupDialog open={open} ilhaName={chosen?.name} onClose={close} />
    </div>
  );
}

function NewGroupDialog({ open, ilhaName, onClose }: { open: boolean; ilhaName: string | undefined; onClose: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) {
      return;
    }
    if (open && !dialog.open) {
      dialog.showModal();
      closeRef.current?.focus();
    } else if (!open && dialog.open) {
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
      aria-labelledby="new-group-title"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      {open ? (
        <>
          <div className="new-conversation-bar">
            <h2 id="new-group-title" className="new-conversation-title">
              Novo grupo
            </h2>
            <button ref={closeRef} type="button" className="icon-button" aria-label="Fechar" onClick={onClose}>
              <X size={20} strokeWidth={1.8} aria-hidden="true" />
            </button>
          </div>
          <p className="conversation-empty">
            {ilhaName ? `Ilha escolhida: ${ilhaName}. ` : ''}A criação de grupos chega na próxima etapa.
          </p>
        </>
      ) : null}
    </dialog>
  );
}
