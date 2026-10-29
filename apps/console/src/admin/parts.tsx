import type { CompanyCommand } from '@viavoip/protocol';
import { createContext, useContext, useEffect, useId, useState, type ReactNode } from 'react';
import { Button, type ButtonVariant } from '../ui/Button.js';
import { ConfirmDialog, Modal } from '../ui/Dialog.js';
import { useToast } from '../ui/Toast.js';
import { useAdminCommand, type AdminContext } from './AdminContext.js';

/** Modal com formulário: os botões ficam no rodapé e enviam o `<form id={formId}>` do conteúdo. */
export function FormModal({
  open,
  title,
  formId,
  submitLabel,
  submitTestId,
  danger = false,
  wide = false,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  formId: string;
  submitLabel: string;
  submitTestId?: string;
  danger?: boolean;
  wide?: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  const [pending, setPending] = useState(false);
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      size={wide ? 'lg' : 'md'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button type="submit" form={formId} variant={danger ? 'danger' : 'primary'} disabled={pending} data-testid={submitTestId}>
            {pending ? 'Salvando…' : submitLabel}
          </Button>
        </>
      }
    >
      <PendingContext.Provider value={setPending}>{children}</PendingContext.Provider>
    </Modal>
  );
}

const PendingContext = createContext<(pending: boolean) => void>(() => undefined);

/**
 * Chamado pelo formulário dentro de um `FormModal`: repassa `pending` ao botão do rodapé
 * e descarta a tentativa (requestId) quando o formulário é desmontado.
 */
export function useModalForm(action: { pending: boolean; reset: () => void }): void {
  const setPending = useContext(PendingContext);
  const { pending, reset } = action;
  useEffect(() => {
    setPending(pending);
  }, [pending, setPending]);
  useEffect(
    () => () => {
      setPending(false);
      reset();
    },
    [reset, setPending],
  );
}

/** Id do `<form>` ligado ao botão de envio do rodapé. */
export function useFormId(): string {
  return `form-${useId().replace(/:/g, '')}`;
}

/** Confirmação para uma ação destrutiva que envia um comando; erros viram toast. */
export function CommandConfirm({
  ctx,
  open,
  title,
  description,
  confirmLabel,
  command,
  success,
  danger = true,
  onClose,
}: {
  ctx: AdminContext;
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  command: CompanyCommand;
  success: string;
  danger?: boolean;
  onClose: () => void;
}) {
  const toast = useToast();
  const action = useAdminCommand(ctx);
  return (
    <ConfirmDialog
      open={open}
      title={title}
      description={description}
      confirmLabel={action.pending ? 'Aguarde…' : confirmLabel}
      danger={danger}
      pending={action.pending}
      onCancel={() => {
        action.reset();
        onClose();
      }}
      onConfirm={() => {
        void action.submit(command, success).then((ok) => {
          if (ok) onClose();
          else toast.notify('error', action.lastError() || 'Não foi possível concluir a ação');
        });
      }}
    />
  );
}

/** Botão que envia um comando direto, sem confirmação (ações reversíveis). */
export function InstantAction({
  ctx,
  command,
  success,
  label,
  variant = 'secondary',
}: {
  ctx: AdminContext;
  command: CompanyCommand;
  success: string;
  label: string;
  variant?: ButtonVariant;
}) {
  const toast = useToast();
  const action = useAdminCommand(ctx);
  return (
    <Button
      size="sm"
      variant={variant}
      disabled={action.pending}
      onClick={() => {
        void action.submit(command, success).then((ok) => {
          if (!ok) toast.notify('error', action.lastError() || 'Não foi possível concluir a ação');
        });
      }}
    >
      {label}
    </Button>
  );
}
