import type { QueueAdmin } from '@viavoip/protocol';
import { Pencil, Plus } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Button } from '../../ui/Button.js';
import { Card } from '../../ui/Card.js';
import { DataTable, type Column } from '../../ui/DataTable.js';
import { Field, Input } from '../../ui/Field.js';
import { EmptyState } from '../../ui/states.js';
import { useAdminCommand, type AdminContext } from '../AdminContext.js';
import { FormModal, useFormId, useModalForm } from '../parts.js';

export function QueuesSection({ ctx }: { ctx: AdminContext }) {
  const [creating, setCreating] = useState(false);
  const [renaming, setRenaming] = useState<QueueAdmin | null>(null);
  const columns: Column<QueueAdmin>[] = [
    { key: 'name', header: 'Fila', render: (queue) => <strong className="cell-person">{queue.name}</strong> },
    {
      key: 'agents',
      header: 'Agentes',
      render: (queue) =>
        ctx.desk.agents.filter((agent) => agent.placement.role === 'agent' && agent.placement.queueIds.includes(queue.id)).length,
    },
    {
      key: 'sla',
      header: 'SLA',
      render: (queue) =>
        ctx.desk.slaPolicies.some((policy) => policy.queueId === queue.id && policy.life.status === 'active') ? 'Publicado' : 'Sem SLA',
    },
    {
      key: 'actions',
      header: 'Ações',
      align: 'end',
      render: (queue) => (
        <span className="row-actions">
          <Button size="sm" variant="secondary" icon={<Pencil size={14} />} onClick={() => setRenaming(queue)}>Renomear</Button>
        </span>
      ),
    },
  ];
  return (
    <Card
      title="Filas de atendimento"
      actions={<Button size="sm" icon={<Plus size={14} />} onClick={() => setCreating(true)}>Nova fila</Button>}
    >
      <DataTable
        caption="Filas"
        columns={columns}
        rows={ctx.desk.queues}
        rowKey={(queue) => queue.id}
        empty={<EmptyState title="Nenhuma fila" description="Crie a primeira fila para receber atendimentos." />}
      />
      <NameModal ctx={ctx} open={creating} title="Nova fila" onClose={() => setCreating(false)} kind="create" />
      <NameModal ctx={ctx} open={renaming !== null} title="Renomear fila" onClose={() => setRenaming(null)} kind="rename" queue={renaming} />
    </Card>
  );
}

function NameModal({
  ctx,
  open,
  title,
  kind,
  queue,
  onClose,
}: {
  ctx: AdminContext;
  open: boolean;
  title: string;
  kind: 'create' | 'rename';
  queue?: QueueAdmin | null;
  onClose: () => void;
}) {
  const formId = useFormId();
  return (
    <FormModal
      open={open}
      title={title}
      formId={formId}
      submitLabel={kind === 'create' ? 'Criar fila' : 'Salvar'}
      submitTestId={kind === 'create' ? 'queue-create' : undefined}
      onClose={onClose}
    >
      <NameForm ctx={ctx} formId={formId} kind={kind} queue={queue ?? null} onDone={onClose} />
    </FormModal>
  );
}

function NameForm({
  ctx,
  formId,
  kind,
  queue,
  onDone,
}: {
  ctx: AdminContext;
  formId: string;
  kind: 'create' | 'rename';
  queue: QueueAdmin | null;
  onDone: () => void;
}) {
  const [name, setName] = useState(queue?.name ?? '');
  const action = useAdminCommand(ctx);
  useModalForm(action);
  async function submit(event: FormEvent) {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    const ok =
      kind === 'create'
        ? await action.submit({ kind: 'queue.create', name: trimmed }, `Fila ${trimmed} criada`)
        : queue
          ? await action.submit({ kind: 'queue.rename', queueId: queue.id, name: trimmed }, `Fila ${trimmed} renomeada`)
          : false;
    if (ok) onDone();
  }
  return (
    <form id={formId} className="form-stack" onSubmit={(event) => void submit(event)}>
      <Field label={kind === 'create' ? 'Nova fila' : 'Nome da fila'}>
        <Input data-testid="queue-name" value={name} onChange={(event) => setName(event.target.value)} maxLength={120} autoFocus />
      </Field>
      {action.error ? <p className="form-error" role="alert">{action.error}</p> : null}
    </form>
  );
}
