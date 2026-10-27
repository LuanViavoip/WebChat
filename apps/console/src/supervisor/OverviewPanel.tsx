import {
  presenceUpdatedSchema,
  supervisorSnapshotAckSchema,
  type SupervisorAgent,
  type SupervisorSnapshot,
} from '@viavoip/protocol';
import { useEffect, useState } from 'react';
import type { Socket } from 'socket.io-client';
import { formatDuration, presenceLabel } from '../desk/format.js';
import { emitAck } from '../realtime.js';

export function OverviewPanel({
  socket,
  mode,
}: {
  socket: Socket | null;
  mode: 'overview' | 'agents';
}) {
  const [snapshot, setSnapshot] = useState<SupervisorSnapshot | null>(null);
  const [sector, setSector] = useState('');
  const [presence, setPresence] = useState('');
  const [activity, setActivity] = useState('');
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!socket) return;
    const reload = () => {
      void emitAck(socket, 'supervisor.snapshot', {}).then((ack) => {
        const parsed = supervisorSnapshotAckSchema.safeParse(ack);
        if (!parsed.success || !parsed.data.ok) return;
        setSnapshot(parsed.data.snapshot);
      });
    };
    const onMetrics = (payload: unknown) => {
      const parsed = supervisorSnapshotAckSchema.safeParse({ ok: true, snapshot: payload });
      if (!parsed.success || !parsed.data.ok) return;
      setSnapshot(parsed.data.snapshot);
    };
    const onPresence = (payload: unknown) => {
      if (!presenceUpdatedSchema.safeParse(payload).success) return;
      reload();
    };
    socket.on('supervisor.metrics', onMetrics);
    socket.on('presence.updated', onPresence);
    socket.on('connect', reload);
    if (socket.connected) reload();
    return () => {
      socket.off('supervisor.metrics', onMetrics);
      socket.off('presence.updated', onPresence);
      socket.off('connect', reload);
    };
  }, [socket]);

  const agents = (snapshot?.agents ?? []).filter((agent) => {
    if (sector && !agent.sectors.includes(sector)) return false;
    if (presence && agent.presence !== presence) return false;
    if (activity && agent.activityName !== activity) return false;
    return true;
  });
  const sectorNames = [...new Set((snapshot?.agents ?? []).flatMap((agent) => agent.sectors))];
  const activityNames = [...new Set((snapshot?.agents ?? []).flatMap((agent) => (agent.activityName ? [agent.activityName] : [])))];

  return (
    <section className="panel">
      {mode === 'overview' && snapshot ? (
        <div className="metrics" data-testid="supervisor-metrics">
          <Metric label="Conectados" value={snapshot.metrics.connected} />
          <Metric label="Disponíveis" value={snapshot.metrics.available} />
          <Metric label="Ocupados" value={snapshot.metrics.busy} />
          <Metric label="Ausentes" value={snapshot.metrics.away} />
          <Metric label="Offline" value={snapshot.metrics.offline} />
          <Metric label="Na fila" value={snapshot.metrics.waiting} />
          <Metric label="Em atendimento" value={snapshot.metrics.assigned} />
          <Metric label="Na pesquisa" value={snapshot.metrics.awaitingSurvey} />
          <Metric label="Atividades" value={snapshot.metrics.activities} />
          <Metric
            label="Maior espera"
            value={snapshot.metrics.longestWaitSeconds === null ? '—' : `${snapshot.metrics.longestWaitSeconds}s`}
          />
          <Metric label="Concluídos" value={snapshot.metrics.closedInPeriod} />
        </div>
      ) : null}
      <div className="stack">
        <select aria-label="Filtrar setor" value={sector} onChange={(event) => setSector(event.target.value)}>
          <option value="">Todos os setores</option>
          {sectorNames.map((name) => (
            <option key={name} value={name}>{name}</option>
          ))}
        </select>
        <select aria-label="Filtrar presença" value={presence} onChange={(event) => setPresence(event.target.value)}>
          <option value="">Toda presença</option>
          <option value="available">Disponível</option>
          <option value="busy">Ocupado</option>
          <option value="away">Ausente</option>
          <option value="offline">Desconectado</option>
        </select>
        <select aria-label="Filtrar atividade" value={activity} onChange={(event) => setActivity(event.target.value)}>
          <option value="">Toda atividade</option>
          {activityNames.map((name) => (
            <option key={name} value={name}>{name}</option>
          ))}
        </select>
      </div>
      <AgentTable agents={agents} now={now} />
    </section>
  );
}

function Metric({ label, value }: { label: string; value: number | string }) {
  return (
    <article>
      <p className="muted">{label}</p>
      <strong>{value}</strong>
    </article>
  );
}

function AgentTable({ agents, now }: { agents: SupervisorAgent[]; now: number }) {
  return (
    <div className="agent-table" role="table">
      {agents.map((agent) => (
        <article key={agent.agentId} role="row">
          <strong>{agent.name}</strong>
          <span>{agent.sectors.join(', ') || 'Sem setor'}</span>
          <span>{presenceLabel(agent.presence)}</span>
          <span>{agent.activityName ?? 'Sem atividade'}</span>
          <span>{agent.activityStartedAt ? formatDuration(agent.activityStartedAt, now) : '—'}</span>
          <span>{agent.activeConversations} atendimento(s)</span>
          <span>{agent.connected ? 'Conectado' : 'Sem conexão'}</span>
        </article>
      ))}
    </div>
  );
}
