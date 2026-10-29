import { X } from 'lucide-react';
import { useEffect, useId, useRef, type ReactNode } from 'react';
import { Button } from './Button.js';

type DialogBaseProps = {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  size?: 'md' | 'lg';
};

/**
 * `<dialog>` nativo aberto com showModal(): o navegador prende o foco, inerta o restante da página
 * e fecha com Esc. O conteúdo só existe enquanto estiver aberto, para não duplicar controles no DOM.
 */
function BaseDialog({
  open,
  onClose,
  title,
  children,
  footer,
  variant,
  size = 'md',
}: DialogBaseProps & { variant: 'modal' | 'drawer-right' | 'drawer-left' }) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
      dialog.querySelector<HTMLElement>('[data-autofocus]')?.focus();
    }
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      className={`ui-dialog ui-dialog--${variant} ui-dialog--${size}`}
      aria-labelledby={titleId}
      onClose={onClose}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      {open ? (
        <div className="ui-dialog__panel">
          <header className="ui-dialog__head">
            <h2 id={titleId}>{title}</h2>
            <button type="button" className="ui-icon-button" aria-label="Fechar" onClick={onClose}>
              <X size={18} aria-hidden="true" />
            </button>
          </header>
          <div className="ui-dialog__body">{children}</div>
          {footer ? <footer className="ui-dialog__foot">{footer}</footer> : null}
        </div>
      ) : null}
    </dialog>
  );
}

export function Modal(props: DialogBaseProps) {
  return <BaseDialog {...props} variant="modal" />;
}

export function Drawer({ side = 'right', ...props }: DialogBaseProps & { side?: 'left' | 'right' }) {
  return <BaseDialog {...props} variant={side === 'left' ? 'drawer-left' : 'drawer-right'} />;
}

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  cancelLabel = 'Cancelar',
  danger = false,
  pending = false,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  cancelLabel?: string;
  danger?: boolean;
  pending?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Modal
      open={open}
      onClose={onCancel}
      title={title}
      footer={
        <>
          <Button variant="secondary" onClick={onCancel} data-autofocus>{cancelLabel}</Button>
          <Button variant={danger ? 'danger' : 'primary'} onClick={onConfirm} disabled={pending}>{confirmLabel}</Button>
        </>
      }
    >
      <p>{description}</p>
    </Modal>
  );
}
