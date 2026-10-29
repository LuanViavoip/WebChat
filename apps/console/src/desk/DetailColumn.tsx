import type {
  ConversationEvent,
  ConversationSummary,
  DispositionSummary,
  PresenceStatus,
  QueueSummary,
} from '@viavoip/protocol';
import { ArrowRightLeft, CheckCheck, Undo2 } from 'lucide-react';
import { Avatar } from '../ui/Avatar.js';
import { Button } from '../ui/Button.js';
import { Field, Select } from '../ui/Field.js';
import { StatusBadge } from '../ui/StatusBadge.js';
import { formatClock, formatDuration, presenceLabel, statusLabel, visitorLabel } from './format.js';
import { statusTone } from './QueueColumn.js';

type Props = {
  conversation: ConversationSummary | null;
  events: ConversationEvent[];
  queues: QueueSummary[];
  dispositions: DispositionSummary[];
  queueId: string;
  dispositionId: string;
  now: number;
  owns: boolean;
  canTransfer: boolean;
  selfStatus: PresenceStatus | null;
  /** `card`: coluna fixa. `plain`: dentro de uma gaveta, que já tem título e moldura. */
  variant: 'card' | 'plain';
  onQueue: (queueId: string) => void;
  onDisposition: (dispositionId: string) => void;
  onRelease: () => void;
  onTransfer: () => void;
  onClose: () => void;
};

export function DetailColumn({
  conversation,
  events,
  queues,
  dispositions,
  queueId,
  dispositionId,
  now,
  owns,
  canTransfer,
  selfStatus,
  variant,
  onQueue,
  onDisposition,
  onRelease,
  onTransfer,
  onClose,
}: Props) {
  const transfers = events.filter((event) => event.type === 'transferred');
  const Root = variant === 'card' ? 'aside' : 'div';
  return (
    <Root
      className={variant === 'card' ? 'desk-card desk-details' : 'desk-details desk-details--plain'}
      data-pane="details"
      aria-label="Detalhes do atendimento"
    >
      {variant === 'card' ? (
        <header className="desk-card__head">
          <h2>Detalhes</h2>
        </header>
      ) : null}
      <div className="desk-details__body">
        {!conversation ? <p className="desk-details__empty">Os dados do contato aparecem aqui.</p> : null}
        {conversation ? (
          <>
            <section className="detail-section" aria-label="Visitante">
              <h3>Visitante</h3>
              <div className="detail-visitor">
                <Avatar name={visitorLabel(conversation.visitorDisplayName)} size={44} />
                <strong data-testid="visitor-name">{visitorLabel(conversation.visitorDisplayName)}</strong>
              </div>
            </section>
            <section className="detail-section" aria-label="Atendimento">
              <h3>Atendimento</h3>
              <dl className="detail-list">
                <div>
                  <dt>Fila</dt>
                  <dd>{conversation.queueName}</dd>
                </div>
                <div>
                  <dt>Estado</dt>
                  <dd><StatusBadge tone={statusTone(conversation.status)}>{statusLabel(conversation.status)}</StatusBadge></dd>
                </div>
                <div>
                  <dt>Agente</dt>
                  <dd>{conversation.agentName ?? 'Sem agente'}</dd>
                </div>
                <div>
                  <dt>Espera</dt>
                  <dd>{conversation.status === 'queued' ? formatDuration(conversation.queuedAt, now) : '—'}</dd>
                </div>
                <div>
                  <dt>Em atendimento há</dt>
                  <dd>{conversation.assignedAt ? formatDuration(conversation.assignedAt, now) : '—'}</dd>
                </div>
                <div>
                  <dt>Sua presença</dt>
                  <dd>{selfStatus ? presenceLabel(selfStatus) : '—'}</dd>
                </div>
              </dl>
            </section>
            <section className="detail-section" aria-label="Transferências">
              <h3>Transferências</h3>
              {transfers.length === 0 ? (
                <p className="desk-details__empty">Nenhuma transferência.</p>
              ) : (
                <ol className="detail-transfers">
                  {transfers.map((event) => (
                    <li key={event.id}>
                      <span>{queueLabel(event.payload.fromQueueId, queues)} para {queueLabel(event.payload.toQueueId, queues)}</span>
                      <time dateTime={event.createdAt}>{formatClock(event.createdAt)}</time>
                    </li>
                  ))}
                </ol>
              )}
            </section>
          </>
        ) : null}
      </div>
      {conversation && (owns || canTransfer) ? (
        <section className="detail-actions" aria-label="Ações">
          {canTransfer ? (
            <div className="detail-action">
              <Field label="Fila de destino">
                <Select data-testid="transfer" value={queueId} onChange={(event) => onQueue(event.target.value)}>
                  {queues.map((queue) => (
                    <option key={queue.id} value={queue.id}>{queue.name}</option>
                  ))}
                </Select>
              </Field>
              <Button variant="secondary" icon={<ArrowRightLeft size={16} />} onClick={onTransfer} disabled={!queueId}>Transferir</Button>
            </div>
          ) : null}
          {owns ? (
            <div className="detail-action">
              <Field label="Classificação">
                <Select data-testid="close" value={dispositionId} onChange={(event) => onDisposition(event.target.value)}>
                  <option value="">Selecione a classificação</option>
                  {dispositions.map((disposition) => (
                    <option key={disposition.id} value={disposition.id}>{disposition.name}</option>
                  ))}
                </Select>
              </Field>
              <Button variant="danger" icon={<CheckCheck size={16} />} onClick={onClose} disabled={!dispositionId}>Encerrar</Button>
            </div>
          ) : null}
          {owns ? (
            <Button data-testid="release" variant="ghost" icon={<Undo2 size={16} />} onClick={onRelease}>Devolver à fila</Button>
          ) : null}
        </section>
      ) : null}
    </Root>
  );
}

function queueLabel(queueId: string | undefined, queues: QueueSummary[]): string {
  if (!queueId) return 'Fila';
  return queues.find((queue) => queue.id === queueId)?.name ?? 'Outra fila';
}
