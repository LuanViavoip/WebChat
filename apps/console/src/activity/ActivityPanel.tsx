import {
  activityAssignmentAckSchema,
  activityCatalogAckSchema,
  activityHistoryAckSchema,
  sectorListAckSchema,
  type ActivityAssignment,
  type ActivityType,
} from '@viavoip/protocol';
import { useEffect, useState } from 'react';
import type { Socket } from 'socket.io-client';
import { formatClock, formatDuration } from '../desk/format.js';
import { ackMessage, emitAck } from '../realtime.js';

export function ActivityPanel({
  socket,
  selfId,
  canAssign,
}: {
  socket: Socket | null;
  selfId: string;
  canAssign: boolean;
}) {
  const [types, setTypes] = useState<ActivityType[]>([]);
  const [current, setCurrent] = useState<ActivityAssignment | null>(null);
  const [history, setHistory] = useState<ActivityAssignment[]>([]);
  const [agents, setAgents] = useState<{ agentId: string; name: string }[]>([]);
  const [agentId, setAgentId] = useState(selfId);
  const [activityTypeId, setActivityTypeId] = useState('');
  const [notice, setNotice] = useState('');
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!socket) return;
    const reload = () => {
      void emitAck(socket, 'activity.catalog', {}).then((ack) => {
        const parsed = activityCatalogAckSchema.safeParse(ack);
        if (!parsed.success || !parsed.data.ok) return;
        const catalog = parsed.data;
        setTypes(catalog.types);
        setCurrent(catalog.current);
        setActivityTypeId((value) => value || catalog.types[0]?.id || '');
      });
      void emitAck(socket, 'activity.history', {}).then((ack) => {
        const parsed = activityHistoryAckSchema.safeParse(ack);
        if (!parsed.success || !parsed.data.ok) return;
        setHistory(parsed.data.assignments);
      });
      if (!canAssign) return;
      void emitAck(socket, 'sector.list', {}).then((ack) => {
        const parsed = sectorListAckSchema.safeParse(ack);
        if (!parsed.success || !parsed.data.ok) return;
        const people = new Map<string, string>();
        for (const sector of parsed.data.sectors.filter((item) => item.canManage)) {
          for (const member of sector.members) people.set(member.agentId, member.name);
        }
        setAgents([...people.entries()].map(([id, name]) => ({ agentId: id, name })));
      });
    };
    socket.on('activity.updated', reload);
    socket.on('connect', reload);
    if (socket.connected) reload();
    return () => {
      socket.off('activity.updated', reload);
      socket.off('connect', reload);
    };
  }, [canAssign, socket]);

  async function assign() {
    if (!socket || !activityTypeId) return;
    const parsed = activityAssignmentAckSchema.safeParse(
      await emitAck(socket, 'activity.assign', { agentId: canAssign ? agentId : selfId, activityTypeId }),
    );
    if (!parsed.success || !parsed.data.ok) {
      setNotice(ackMessage(parsed, 'Alocação recusada'));
      return;
    }
    setNotice(`${parsed.data.assignment.agentName} em ${parsed.data.assignment.activityName}`);
    if (parsed.data.assignment.agentId === selfId) setCurrent(parsed.data.assignment);
  }

  async function finish() {
    if (!socket) return;
    const parsed = activityAssignmentAckSchema.safeParse(
      await emitAck(socket, 'activity.finish', { agentId: canAssign ? agentId : selfId }),
    );
    if (!parsed.success || !parsed.data.ok) {
      setNotice(ackMessage(parsed, 'Não há atividade em andamento'));
      return;
    }
    setNotice('Atividade encerrada');
    if (parsed.data.assignment.agentId === selfId) setCurrent(null);
  }

  return (
    <section className="panel">
      <h2>{canAssign ? 'Atividades' : 'Minha atividade'}</h2>
      {current ? (
        <p data-testid="current-activity">
          {current.activityName} desde {formatClock(current.startedAt)} · {formatDuration(current.startedAt, now)}
        </p>
      ) : (
        <p className="muted">Sem atividade em andamento.</p>
      )}
      {notice ? <p className="ok">{notice}</p> : null}
      <div className="stack">
        {canAssign ? (
          <label>
            Agente
            <select value={agentId} onChange={(event) => setAgentId(event.target.value)}>
              <option value={selfId}>Eu</option>
              {agents.map((agent) => (
                <option key={agent.agentId} value={agent.agentId}>{agent.name}</option>
              ))}
            </select>
          </label>
        ) : null}
        <label>
          Atividade
          <select value={activityTypeId} onChange={(event) => setActivityTypeId(event.target.value)}>
            {types.map((type) => (
              <option key={type.id} value={type.id}>{type.name}</option>
            ))}
          </select>
        </label>
        <button type="button" onClick={() => void assign()}>Alocar</button>
        <button type="button" onClick={() => void finish()}>Encerrar</button>
      </div>
      <h3>Histórico</h3>
      <ul className="transfers">
        {history.map((item) => (
          <li key={item.id}>
            {item.activityName} · {formatClock(item.startedAt)}
            {item.endedAt ? ` até ${formatClock(item.endedAt)}` : ' · em andamento'}
          </li>
        ))}
      </ul>
    </section>
  );
}
