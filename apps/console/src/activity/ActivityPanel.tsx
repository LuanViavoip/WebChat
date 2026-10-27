import {
  activityAssignmentAckSchema,
  activityCatalogAckSchema,
  activityHistoryAckSchema,
  activityTypeSchema,
  sectorListAckSchema,
  type ActivityAssignment,
  type ActivityType,
} from '@viavoip/protocol';
import { useEffect, useState, type FormEvent } from 'react';
import type { Socket } from 'socket.io-client';
import { formatClock, formatDuration } from '../desk/format.js';
import { ackMessage, emitAck } from '../realtime.js';

export function ActivityPanel({
  socket,
  selfId,
  canAssign,
  isAdmin,
}: {
  socket: Socket | null;
  selfId: string;
  canAssign: boolean;
  isAdmin: boolean;
}) {
  const [types, setTypes] = useState<ActivityType[]>([]);
  const [current, setCurrent] = useState<ActivityAssignment | null>(null);
  const [history, setHistory] = useState<ActivityAssignment[]>([]);
  const [agents, setAgents] = useState<{ agentId: string; name: string }[]>([]);
  const [agentId, setAgentId] = useState(selfId);
  const [activityTypeId, setActivityTypeId] = useState('');
  const [notice, setNotice] = useState('');
  const [now, setNow] = useState(() => Date.now());
  const [typeName, setTypeName] = useState('');
  const [typeActive, setTypeActive] = useState(true);
  const [editingTypeId, setEditingTypeId] = useState('');

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

  function editType(type: ActivityType) {
    setEditingTypeId(type.id);
    setTypeName(type.name);
    setTypeActive(type.active);
  }

  async function saveType(event: FormEvent) {
    event.preventDefault();
    if (!socket || !isAdmin) return;
    const ack = await emitAck(socket, 'activity.type.save', {
      ...(editingTypeId ? { activityTypeId: editingTypeId } : {}),
      name: typeName,
      active: typeActive,
    });
    const value = typeof ack === 'object' && ack !== null && 'activityType' in ack ? ack.activityType : null;
    const parsed = activityTypeSchema.safeParse(value);
    if (!parsed.success) {
      setNotice(ackMessage({ success: true, data: ack }, 'Tipo de atividade recusado'));
      return;
    }
    setTypes((current) => [...current.filter((type) => type.id !== parsed.data.id), parsed.data].sort((a, b) => a.name.localeCompare(b.name)));
    setActivityTypeId((current) => current || (parsed.data.active ? parsed.data.id : ''));
    setEditingTypeId('');
    setTypeName('');
    setTypeActive(true);
    setNotice('Tipo de atividade salvo');
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
            {types.filter((type) => type.active).map((type) => (
              <option key={type.id} value={type.id}>{type.name}</option>
            ))}
          </select>
        </label>
        <button type="button" onClick={() => void assign()}>Alocar</button>
        <button type="button" onClick={() => void finish()}>Encerrar</button>
      </div>
      {isAdmin ? (
        <div className="stack">
          <h3>Catálogo de atividades</h3>
          {types.map((type) => (
            <div key={type.id}>
              <span>{type.name} · {type.active ? 'Ativa' : 'Inativa'}</span>
              <button type="button" onClick={() => editType(type)}>Editar</button>
            </div>
          ))}
          <form onSubmit={(event) => void saveType(event)}>
            <label>Nome<input value={typeName} onChange={(event) => setTypeName(event.target.value)} /></label>
            <label><input type="checkbox" checked={typeActive} onChange={(event) => setTypeActive(event.target.checked)} /> Ativa</label>
            <button type="submit">{editingTypeId ? 'Salvar tipo' : 'Criar tipo'}</button>
            {editingTypeId ? <button type="button" onClick={() => { setEditingTypeId(''); setTypeName(''); setTypeActive(true); }}>Cancelar</button> : null}
          </form>
        </div>
      ) : null}
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
