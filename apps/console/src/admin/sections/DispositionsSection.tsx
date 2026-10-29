import type { DispositionAdmin } from '@viavoip/protocol';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { formatDateTime } from '../../desk/format.js';
import { Button } from '../../ui/Button.js';
import { Card } from '../../ui/Card.js';
import { DataTable, type Column } from '../../ui/DataTable.js';
import { Field, Input } from '../../ui/Field.js';
import { EmptyState } from '../../ui/states.js';
import { StatusBadge } from '../../ui/StatusBadge.js';
import { useAdminCommand, type AdminContext } from '../AdminContext.js';
import { CommandConfirm, FormModal, useFormId, useModalForm } from '../parts.js';

export function DispositionsSection({ ctx }: { ctx: AdminContext }) {
  const [creating, setCreating] = useState(false);
  const [renaming, setRenaming] = useState<DispositionAdmin | null>(null);
  const [retiring, setRetiring] = useState<DispositionAdmin | null>(null);
  const columns: Column<DispositionAdmin>[] = [
    { key: 'name', header: 'Classificação', render: (item) => <strong className="cell-person">{item.name}</strong> },
    {
      key: 'status',
      header: 'Situação',
      render: (item) =>
        item.publication.status === 'active' ? (
          <StatusBadge tone="success">Ativa</StatusBadge>
        ) : (
          <span title={`Retirada em ${formatDateTime(item.publication.retiredAt)}`}><StatusBadge tone="neutral">Retirada</StatusBadge></span>
        ),
    },
    {
      key: 'actions',
      header: 'Ações',
      align: 'end',
      render: (item) =>
        item.publication.status === 'active' ? (
          <span className="row-actions">
            <Button size="sm" variant="secondary" icon={<Pencil size={14} />} onClick={() => setRenaming(item)}>Renomear</Button>
            <Button size="sm" variant="ghost" icon={<Trash2 size={14} />} onClick={() => setRetiring(item)}>Retirar</Button>
          </span>
        ) : null,
    },
  ];
  return (
    <Card
      title="Classificações de encerramento"
      actions={<Button size="sm" icon={<Plus size={14} />} onClick={() => setCreating(true)}>Nova classificação</Button>}
    >
      <DataTable
        caption="Classificações"
        columns={columns}
        rows={ctx.desk.dispositions}
        rowKey={(item) => item.id}
        empty={<EmptyState title="Nenhuma classificação" description="Os agentes escolhem uma classificação ao encerrar um atendimento." />}
      />
      <NameModal ctx={ctx} open={creating} onClose={() => setCreating(false)} item={null} />
      <NameModal ctx={ctx} open={renaming !== null} onClose={() => setRenaming(null)} item={renaming} />
      <CommandConfirm
        ctx={ctx}
        open={retiring !== null}
        title="Retirar classificação?"
        description={`“${retiring?.name ?? ''}” deixa de aparecer ao encerrar atendimentos. Os atendimentos já classificados não mudam.`}
        confirmLabel="Retirar"
        command={{ kind: 'disposition.retire', dispositionId: retiring?.id ?? '' }}
        success={`Classificação ${retiring?.name ?? ''} retirada`}
        onClose={() => setRetiring(null)}
      />
    </Card>
  );
}

function NameModal({ ctx, open, item, onClose }: { ctx: AdminContext; open: boolean; item: DispositionAdmin | null; onClose: () => void }) {
  const formId = useFormId();
  return (
    <FormModal
      open={open}
      title={item ? 'Renomear classificação' : 'Nova classificação'}
      formId={formId}
      submitLabel={item ? 'Salvar' : 'Criar'}
      onClose={onClose}
    >
      <NameForm ctx={ctx} formId={formId} item={item} onDone={onClose} />
    </FormModal>
  );
}

function NameForm({ ctx, formId, item, onDone }: { ctx: AdminContext; formId: string; item: DispositionAdmin | null; onDone: () => void }) {
  const [name, setName] = useState(item?.name ?? '');
  const action = useAdminCommand(ctx);
  useModalForm(action);
  async function submit(event: FormEvent) {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    const ok = item
      ? await action.submit({ kind: 'disposition.rename', dispositionId: item.id, name: trimmed }, `Classificação ${trimmed} renomeada`)
      : await action.submit({ kind: 'disposition.create', name: trimmed }, `Classificação ${trimmed} criada`);
    if (ok) onDone();
  }
  return (
    <form id={formId} className="form-stack" onSubmit={(event) => void submit(event)}>
      <Field label="Nome da classificação">
        <Input value={name} onChange={(event) => setName(event.target.value)} maxLength={120} autoFocus />
      </Field>
      {action.error ? <p className="form-error" role="alert">{action.error}</p> : null}
    </form>
  );
}
