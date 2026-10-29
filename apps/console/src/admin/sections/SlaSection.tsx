import type { QueueAdmin, SlaPolicyView } from '@viavoip/protocol';
import { FilePlus2, Trash2 } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { formatDateTime, formatSeconds } from '../../desk/format.js';
import { isoToLocalInput, localInputToIso } from '../../quality/period.js';
import { Button } from '../../ui/Button.js';
import { Card } from '../../ui/Card.js';
import { DataTable, type Column } from '../../ui/DataTable.js';
import { Field, Input } from '../../ui/Field.js';
import { EmptyState } from '../../ui/states.js';
import { StatusBadge } from '../../ui/StatusBadge.js';
import { useAdminCommand, type AdminContext } from '../AdminContext.js';
import { CommandConfirm, FormModal, useFormId, useModalForm } from '../parts.js';
import { slaStateLabel, slaVersions, type SlaVersion, type SlaVersionState } from '../sla-history.js';

const stateTone: Record<SlaVersionState, 'success' | 'info' | 'warning' | 'neutral'> = {
  current: 'success',
  scheduled: 'info',
  ending: 'warning',
  retired: 'neutral',
};

const versionColumns: Column<SlaVersion>[] = [
  { key: 'version', header: 'Versão', render: (version) => <strong className="cell-person">v{version.number}</strong> },
  { key: 'wait', header: 'Espera na fila', render: (version) => formatSeconds(version.queueWaitSeconds) },
  { key: 'reply', header: 'Primeira resposta', render: (version) => formatSeconds(version.firstResponseSeconds) },
  { key: 'from', header: 'Vigente desde', render: (version) => formatDateTime(version.effectiveFrom) },
  { key: 'until', header: 'Encerrada em', render: (version) => (version.retiredAt ? formatDateTime(version.retiredAt) : '—') },
  {
    key: 'state',
    header: 'Situação',
    render: (version) => <StatusBadge tone={stateTone[version.state]}>{slaStateLabel[version.state]}</StatusBadge>,
  },
];

export function SlaSection({ ctx }: { ctx: AdminContext }) {
  return (
    <>
      <SlaTargets ctx={ctx} />
      <SlaHistory ctx={ctx} />
    </>
  );
}

function SlaTargets({ ctx }: { ctx: AdminContext }) {
  const [publishing, setPublishing] = useState<QueueAdmin | null>(null);
  const [retiring, setRetiring] = useState<QueueAdmin | null>(null);
  const activeFor = (queue: QueueAdmin): SlaPolicyView | undefined =>
    ctx.desk.slaPolicies.find((policy) => policy.queueId === queue.id && policy.life.status === 'active');
  const columns: Column<QueueAdmin>[] = [
    { key: 'queue', header: 'Fila', render: (queue) => <strong className="cell-person">{queue.name}</strong> },
    {
      key: 'wait',
      header: 'Espera na fila',
      render: (queue) => {
        const policy = activeFor(queue);
        return policy ? formatSeconds(policy.queueWait.thresholdSeconds) : '—';
      },
    },
    {
      key: 'reply',
      header: 'Primeira resposta',
      render: (queue) => {
        const policy = activeFor(queue);
        return policy ? formatSeconds(policy.firstResponse.thresholdSeconds) : '—';
      },
    },
    {
      key: 'status',
      header: 'Situação',
      render: (queue) => {
        const policy = activeFor(queue);
        if (!policy) return <StatusBadge tone="neutral">Sem SLA</StatusBadge>;
        const since = policy.life.effectiveFrom;
        const future = Date.parse(since) > Date.now();
        return (
          <span title={`Vigência desde ${formatDateTime(since)}`}>
            <StatusBadge tone={future ? 'info' : 'success'}>{future ? 'Agendado' : 'Vigente'}</StatusBadge>
          </span>
        );
      },
    },
    {
      key: 'actions',
      header: 'Ações',
      align: 'end',
      render: (queue) => (
        <span className="row-actions">
          <Button size="sm" variant="secondary" icon={<FilePlus2 size={14} />} onClick={() => setPublishing(queue)}>
            {activeFor(queue) ? 'Nova versão' : 'Publicar'}
          </Button>
          {activeFor(queue) ? (
            <Button size="sm" variant="ghost" icon={<Trash2 size={14} />} onClick={() => setRetiring(queue)}>Retirar</Button>
          ) : null}
        </span>
      ),
    },
  ];
  return (
    <Card title="Metas de SLA por fila">
      <p className="page__meta">Limites em que a espera e a primeira resposta contam como cumpridas. Cada publicação vale a partir do horário escolhido, nunca retroativamente.</p>
      <DataTable
        caption="SLA por fila"
        columns={columns}
        rows={ctx.desk.queues}
        rowKey={(queue) => queue.id}
        empty={<EmptyState title="Nenhuma fila" description="Crie uma fila para definir metas de SLA." />}
      />
      <PublishModal ctx={ctx} queue={publishing} onClose={() => setPublishing(null)} />
      <CommandConfirm
        ctx={ctx}
        open={retiring !== null}
        title="Retirar SLA?"
        description={`A fila ${retiring?.name ?? ''} deixa de ter metas de SLA e os próximos atendimentos não serão avaliados.`}
        confirmLabel="Retirar SLA"
        command={{ kind: 'sla.retire', queueId: retiring?.id ?? '' }}
        success={`SLA da fila ${retiring?.name ?? ''} retirado`}
        onClose={() => setRetiring(null)}
      />
    </Card>
  );
}

function SlaHistory({ ctx }: { ctx: AdminContext }) {
  const now = Date.now();
  const history = ctx.desk.queues
    .map((queue) => ({ queue, versions: slaVersions(ctx.desk.slaPolicies, queue.id, now) }))
    .filter((entry) => entry.versions.length > 0);
  return (
    <Card title="Histórico de versões">
      <p className="page__meta">Somente leitura. Cada publicação cria uma nova versão e a anterior é encerrada, sem apagar o registro.</p>
      {history.length === 0 ? (
        <EmptyState title="Sem versões" description="Publique uma meta de SLA para começar o histórico." />
      ) : (
        history.map(({ queue, versions }) => (
          <div key={queue.id} className="sla-history" data-testid="sla-history">
            <h3 className="sla-history__queue">{queue.name}</h3>
            <DataTable caption={`Versões de SLA da fila ${queue.name}`} columns={versionColumns} rows={versions} rowKey={(version) => version.id} empty={null} />
          </div>
        ))
      )}
    </Card>
  );
}

function PublishModal({ ctx, queue, onClose }: { ctx: AdminContext; queue: QueueAdmin | null; onClose: () => void }) {
  const formId = useFormId();
  return (
    <FormModal open={queue !== null} title={`SLA da fila ${queue?.name ?? ''}`} formId={formId} submitLabel="Publicar SLA" onClose={onClose}>
      {queue ? <PublishForm ctx={ctx} formId={formId} queue={queue} onDone={onClose} /> : null}
    </FormModal>
  );
}

function PublishForm({ ctx, formId, queue, onDone }: { ctx: AdminContext; formId: string; queue: QueueAdmin; onDone: () => void }) {
  const current = ctx.desk.slaPolicies.find((policy) => policy.queueId === queue.id && policy.life.status === 'active');
  const [wait, setWait] = useState(String(current?.queueWait.thresholdSeconds ?? 120));
  const [reply, setReply] = useState(String(current?.firstResponse.thresholdSeconds ?? 300));
  // A publicação não pode ser retroativa: o padrão é daqui a alguns minutos.
  const [from, setFrom] = useState(() => isoToLocalInput(new Date(Date.now() + 5 * 60_000).toISOString()));
  const [localError, setLocalError] = useState('');
  const action = useAdminCommand(ctx);
  useModalForm(action);
  async function submit(event: FormEvent) {
    event.preventDefault();
    const effectiveFrom = localInputToIso(from);
    if (!effectiveFrom || Date.parse(effectiveFrom) <= Date.now()) {
      setLocalError('Escolha um início de vigência no futuro.');
      return;
    }
    setLocalError('');
    const ok = await action.submit(
      {
        kind: 'sla.publish',
        queueId: queue.id,
        effectiveFrom,
        queueWaitThresholdSeconds: Number(wait),
        firstResponseThresholdSeconds: Number(reply),
      },
      `SLA da fila ${queue.name} publicado`,
    );
    if (ok) onDone();
  }
  return (
    <form id={formId} className="form-stack" onSubmit={(event) => void submit(event)}>
      <div className="form-grid">
        <Field label="Espera na fila (segundos)" hint="De 1 a 86400.">
          <Input type="number" min={1} max={86400} value={wait} onChange={(event) => setWait(event.target.value)} />
        </Field>
        <Field label="Primeira resposta (segundos)" hint="De 1 a 86400.">
          <Input type="number" min={1} max={86400} value={reply} onChange={(event) => setReply(event.target.value)} />
        </Field>
      </div>
      <Field label="Vigente a partir de">
        <Input type="datetime-local" value={from} onChange={(event) => setFrom(event.target.value)} />
      </Field>
      {localError || action.error ? <p className="form-error" role="alert">{localError || action.error}</p> : null}
    </form>
  );
}
