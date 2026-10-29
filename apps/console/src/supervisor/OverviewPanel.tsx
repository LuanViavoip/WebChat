import {
  presenceUpdatedSchema,
  supervisorSnapshotAckSchema,
  type SupervisorAgent,
  type SupervisorSnapshot,
} from '@viavoip/protocol';
import {
  Activity,
  CheckCheck,
  CircleCheck,
  Clock,
  ClipboardCheck,
  Headset,
  Hourglass,
  Inbox,
  MoonStar,
  Power,
  Timer,
  UserRoundSearch,
  Wifi,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import type { Socket } from 'socket.io-client';
import { formatDuration, formatSeconds, formatTime, presenceLabel } from '../desk/format.js';
import { presenceTone } from '../desk/presence.js';
import { emitAck } from '../realtime.js';
import { Avatar } from '../ui/Avatar.js';
import { Card, StatCard } from '../ui/Card.js';
import { DataTable, type Column } from '../ui/DataTable.js';
import { Select } from '../ui/Field.js';
import { useNow } from '../ui/hooks.js';
import { EmptyState, LoadingState } from '../ui/states.js';
import { StatusBadge } from '../ui/StatusBadge.js';
import { distinctActivities, distinctSectors, filterAgents } from './agents.js';

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
  const now = useNow();

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

  if (!snapshot) return <LoadingState label="Carregando painel…" />;

  const agents = filterAgents(snapshot.agents, { sector, presence, activity });
  const metrics = snapshot.metrics;

  return (
    <div className="page">
      {mode === 'overview' ? (
        <div className="page" data-testid="supervisor-metrics">
          <p className="page__meta">
            Atualizado às <time dateTime={metrics.generatedAt}>{formatTime(metrics.generatedAt)}</time>
          </p>
          <section className="page__section" aria-label="Presença">
            <h2>Presença</h2>
            <div className="stat-grid">
              <StatCard label="Conectados" value={metrics.connected} icon={Wifi} tone="info" description="Agentes com a central aberta neste momento." />
              <StatCard label="Disponíveis" value={metrics.available} icon={CircleCheck} tone="success" description="Prontos para assumir novos atendimentos." />
              <StatCard label="Ocupados" value={metrics.busy} icon={Clock} tone="warning" description="Em atendimento ou com o limite de conversas atingido." />
              <StatCard label="Ausentes" value={metrics.away} icon={MoonStar} tone="info" description="Marcaram ausência e não recebem novos atendimentos." />
              <StatCard label="Offline" value={metrics.offline} icon={Power} tone="neutral" description="Agentes sem conexão com a central." />
            </div>
          </section>
          <section className="page__section" aria-label="Fila">
            <h2>Fila</h2>
            <div className="stat-grid">
              <StatCard label="Na fila" value={metrics.waiting} icon={Inbox} tone="warning" description="Contatos aguardando um agente." />
              <StatCard label="Em atendimento" value={metrics.assigned} icon={Headset} tone="success" description="Conversas com um agente respondendo." />
              <StatCard label="Na pesquisa" value={metrics.awaitingSurvey} icon={ClipboardCheck} tone="info" description="Encerradas, aguardando a resposta do visitante à pesquisa." />
            </div>
          </section>
          <section className="page__section" aria-label="Operação">
            <h2>Operação</h2>
            <div className="stat-grid">
              <StatCard label="Atividades" value={metrics.activities} icon={Activity} tone="info" description="Agentes em uma atividade (reunião, treinamento etc.)." />
              <StatCard
                label="Maior espera"
                value={metrics.longestWaitSeconds === null ? '—' : formatSeconds(metrics.longestWaitSeconds)}
                icon={Hourglass}
                tone="warning"
                description="Há quanto tempo o contato que mais espera está na fila."
              />
              <StatCard label="Concluídos" value={metrics.closedInPeriod} icon={CheckCheck} tone="success" description="Atendimentos encerrados no período recente." />
            </div>
          </section>
        </div>
      ) : null}
      <Card
        title="Agentes"
        actions={<span className="page__meta">{agents.length} de {snapshot.agents.length}</span>}
      >
        <div className="toolbar">
          <Select aria-label="Filtrar setor" value={sector} onChange={(event) => setSector(event.target.value)}>
            <option value="">Todos os setores</option>
            {distinctSectors(snapshot.agents).map((name) => (
              <option key={name} value={name}>{name}</option>
            ))}
          </Select>
          <Select aria-label="Filtrar presença" value={presence} onChange={(event) => setPresence(event.target.value)}>
            <option value="">Toda presença</option>
            <option value="available">Disponível</option>
            <option value="busy">Ocupado</option>
            <option value="away">Ausente</option>
            <option value="offline">Offline</option>
          </Select>
          <Select aria-label="Filtrar atividade" value={activity} onChange={(event) => setActivity(event.target.value)}>
            <option value="">Toda atividade</option>
            {distinctActivities(snapshot.agents).map((name) => (
              <option key={name} value={name}>{name}</option>
            ))}
          </Select>
        </div>
        <DataTable
          caption="Agentes"
          columns={agentColumns(now)}
          rows={agents}
          rowKey={(agent) => agent.agentId}
          empty={
            <EmptyState
              icon={UserRoundSearch}
              title="Nenhum agente encontrado"
              description={snapshot.agents.length === 0 ? 'Ainda não há agentes nos seus setores.' : 'Ajuste os filtros para ver outros agentes.'}
            />
          }
        />
      </Card>
    </div>
  );
}

function agentColumns(now: number): Column<SupervisorAgent>[] {
  return [
    {
      key: 'name',
      header: 'Nome',
      render: (agent) => (
        <span className="cell-person">
          <Avatar name={agent.name} size={32} />
          {agent.name}
        </span>
      ),
    },
    { key: 'sectors', header: 'Setores', render: (agent) => agent.sectors.join(', ') || 'Sem setor' },
    {
      key: 'presence',
      header: 'Presença',
      render: (agent) => <StatusBadge tone={presenceTone(agent.presence)} dot>{presenceLabel(agent.presence)}</StatusBadge>,
    },
    {
      key: 'link',
      header: 'Conectividade',
      render: (agent) => (
        <StatusBadge tone={agent.connected ? 'success' : 'neutral'}>{agent.connected ? 'Conectado' : 'Sem conexão'}</StatusBadge>
      ),
    },
    { key: 'activity', header: 'Atividade', render: (agent) => agent.activityName ?? 'Sem atividade' },
    {
      key: 'time',
      header: 'Tempo',
      render: (agent) => (agent.activityStartedAt ? formatDuration(agent.activityStartedAt, now) : '—'),
    },
    { key: 'conversations', header: 'Atendimentos', align: 'end', render: (agent) => `${agent.activeConversations} atendimento(s)` },
  ];
}
