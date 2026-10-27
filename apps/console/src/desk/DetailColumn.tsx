import type {
  ConversationEvent,
  ConversationSummary,
  DispositionSummary,
  PresenceStatus,
  QueueSummary,
} from '@viavoip/protocol';
import { formatClock, formatDuration, presenceLabel, statusLabel, visitorLabel } from './format.js';

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
  onQueue: (queueId: string) => void;
  onDisposition: (dispositionId: string) => void;
  onRelease: () => void;
  onTransfer: () => void;
  onClose: () => void;
  selfStatus: PresenceStatus;
  active: boolean;
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
  onQueue,
  onDisposition,
  onRelease,
  onTransfer,
  onClose,
  selfStatus,
  active,
}: Props) {
  const transfers = events.filter((event) => event.type === 'transferred');
  return (
    <aside className={active ? 'pane detail-pane active' : 'pane detail-pane'} data-pane="details" aria-label="Detalhes do atendimento">
      <h2>Detalhes</h2>
      {!conversation ? <p className="muted">Os dados do contato aparecem aqui.</p> : null}
      {conversation ? (
        <dl>
          <div>
            <dt>Visitante</dt>
            <dd data-testid="visitor-name">{visitorLabel(conversation.visitorDisplayName)}</dd>
          </div>
          <div>
            <dt>Fila</dt>
            <dd>{conversation.queueName}</dd>
          </div>
          <div>
            <dt>Estado</dt>
            <dd>{statusLabel(conversation.status)}</dd>
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
            <dt>Atendimento</dt>
            <dd>{conversation.assignedAt ? formatDuration(conversation.assignedAt, now) : '—'}</dd>
          </div>
          <div>
            <dt>Sua presença</dt>
            <dd>{presenceLabel(selfStatus)}</dd>
          </div>
        </dl>
      ) : null}
      {transfers.length > 0 ? (
        <section aria-label="Transferências">
          <h3>Transferências</h3>
          <ol className="transfers">
            {transfers.map((event) => (
              <li key={event.id}>
                {queueLabel(event.payload.fromQueueId, queues)} para {queueLabel(event.payload.toQueueId, queues)}
                <time dateTime={event.createdAt}>{formatClock(event.createdAt)}</time>
              </li>
            ))}
          </ol>
        </section>
      ) : null}
      {owns || canTransfer ? (
        <div className="stack">
          {owns ? (
            <button data-testid="release" type="button" onClick={onRelease}>Devolver à fila</button>
          ) : null}
          {canTransfer ? (
            <>
              <label>
                Fila de destino
                <select data-testid="transfer" value={queueId} onChange={(event) => onQueue(event.target.value)}>
                  {queues.map((queue) => (
                    <option key={queue.id} value={queue.id}>{queue.name}</option>
                  ))}
                </select>
              </label>
              <button type="button" onClick={onTransfer} disabled={!queueId}>Transferir</button>
            </>
          ) : null}
          {owns ? (
            <>
              <label>
                Classificação
                <select data-testid="close" value={dispositionId} onChange={(event) => onDisposition(event.target.value)}>
                  <option value="">Selecione a classificação</option>
                  {dispositions.map((disposition) => (
                    <option key={disposition.id} value={disposition.id}>{disposition.name}</option>
                  ))}
                </select>
              </label>
              <button type="button" onClick={onClose} disabled={!dispositionId}>Encerrar</button>
            </>
          ) : null}
        </div>
      ) : null}
    </aside>
  );
}

function queueLabel(queueId: string | undefined, queues: QueueSummary[]): string {
  if (!queueId) return 'Fila';
  return queues.find((queue) => queue.id === queueId)?.name ?? 'Outra fila';
}
