import {
  activityAssignmentAckSchema,
  activityCatalogAckSchema,
  activityHistoryAckSchema,
  activityTypeSchema,
  sectorListAckSchema,
  type ActivityAssignment,
  type ActivityType,
} from '@viavoip/protocol';
import { Activity, Pencil, Play, Plus, Square } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import type { Socket } from 'socket.io-client';
import { formatClock, formatDateTime, formatDuration } from '../desk/format.js';
import { ackMessage, emitAck } from '../realtime.js';
import { Button } from '../ui/Button.js';
import { Card } from '../ui/Card.js';
import { DataTable, type Column } from '../ui/DataTable.js';
import { Modal } from '../ui/Dialog.js';
import { Field, Input, Select } from '../ui/Field.js';
import { useNow } from '../ui/hooks.js';
import { EmptyState } from '../ui/states.js';
import { StatusBadge } from '../ui/StatusBadge.js';
import { useToast } from '../ui/Toast.js';

export function ActivityPanel({
  socket,
  selfId,
  canAssign,
  canChangeOwn,
  isAdmin,
}: {
  socket: Socket | null;
  selfId: string;
  /** Supervisão e administração alocam atividades da equipe. */
  canAssign: boolean;
  /** Permissão concedida pelo administrador para o agente registrar a própria atividade. */
  canChangeOwn: boolean;
  isAdmin: boolean;
}) {
  const [types, setTypes] = useState<ActivityType[]>([]);
  const [current, setCurrent] = useState<ActivityAssignment | null>(null);
  const [history, setHistory] = useState<ActivityAssignment[]>([]);
  const [agents, setAgents] = useState<{ agentId: string; name: string }[]>([]);
  const [agentId, setAgentId] = useState(selfId);
  const [activityTypeId, setActivityTypeId] = useState('');
  const [typeEditor, setTypeEditor] = useState<{ type: ActivityType | null } | null>(null);
  const now = useNow();
  const toast = useToast();

  useEffect(() => {
    if (!socket) return;
    const reload = () => {
      void emitAck(socket, 'activity.catalog', {}).then((ack) => {
        const parsed = activityCatalogAckSchema.safeParse(ack);
        if (!parsed.success || !parsed.data.ok) return;
        const catalog = parsed.data;
        setTypes(catalog.types);
        setCurrent(catalog.current);
        setActivityTypeId((value) => value || catalog.types.find((type) => type.active)?.id || '');
      });
      void emitAck(socket, 'activity.history', canAssign && agentId !== selfId ? { agentId } : {}).then((ack) => {
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
  }, [agentId, canAssign, selfId, socket]);

  async function assign() {
    if (!socket || !activityTypeId) return;
    const parsed = activityAssignmentAckSchema.safeParse(
      await emitAck(socket, 'activity.assign', { agentId: canAssign ? agentId : selfId, activityTypeId }),
    );
    if (!parsed.success || !parsed.data.ok) {
      toast.notify('error', ackMessage(parsed, 'Alocação recusada'));
      return;
    }
    toast.notify('ok', `${parsed.data.assignment.agentName} em ${parsed.data.assignment.activityName}`);
    if (parsed.data.assignment.agentId === selfId) setCurrent(parsed.data.assignment);
  }

  async function finish() {
    if (!socket) return;
    const parsed = activityAssignmentAckSchema.safeParse(
      await emitAck(socket, 'activity.finish', { agentId: canAssign ? agentId : selfId }),
    );
    if (!parsed.success || !parsed.data.ok) {
      toast.notify('error', ackMessage(parsed, 'Não há atividade em andamento'));
      return;
    }
    toast.notify('ok', 'Atividade encerrada');
    if (parsed.data.assignment.agentId === selfId) setCurrent(null);
  }

  // Com outro agente escolhido, a atividade atual vem do histórico dele (o catálogo traz só a minha).
  const shown = canAssign && agentId !== selfId ? (history.find((item) => item.endedAt === null) ?? null) : current;

  const historyColumns: Column<ActivityAssignment>[] = [
    { key: 'activity', header: 'Atividade', render: (item) => <strong className="cell-person">{item.activityName}</strong> },
    ...(canAssign ? [{ key: 'agent', header: 'Agente', render: (item: ActivityAssignment) => item.agentName }] : []),
    { key: 'start', header: 'Início', render: (item) => formatDateTime(item.startedAt) },
    {
      key: 'end',
      header: 'Fim',
      render: (item) => (item.endedAt ? formatDateTime(item.endedAt) : <StatusBadge tone="success" dot>Em andamento</StatusBadge>),
    },
    {
      key: 'duration',
      header: 'Duração',
      align: 'end',
      render: (item) => (item.endedAt ? formatDuration(item.startedAt, Date.parse(item.endedAt)) : formatDuration(item.startedAt, now)),
    },
  ];

  const typeColumns: Column<ActivityType>[] = [
    { key: 'name', header: 'Atividade', render: (type) => <strong className="cell-person">{type.name}</strong> },
    { key: 'status', header: 'Situação', render: (type) => <StatusBadge tone={type.active ? 'success' : 'neutral'}>{type.active ? 'Ativa' : 'Inativa'}</StatusBadge> },
    {
      key: 'actions',
      header: 'Ações',
      align: 'end',
      render: (type) => (
        <span className="row-actions">
          <Button size="sm" variant="secondary" icon={<Pencil size={14} />} onClick={() => setTypeEditor({ type })}>Editar</Button>
        </span>
      ),
    },
  ];

  return (
    <div className="page">
      <Card title={canAssign ? 'Atividades' : 'Minha atividade'}>
        {shown ? (
          <p className="activity-now" data-testid="current-activity">
            <StatusBadge tone="success" dot>Em andamento</StatusBadge>{' '}
            {shown.agentId !== selfId ? `${shown.agentName}: ` : null}
            <strong>{shown.activityName}</strong> desde {formatClock(shown.startedAt)} · {formatDuration(shown.startedAt, now)}
          </p>
        ) : (
          <p className="page__meta">Sem atividade em andamento.</p>
        )}
        {canAssign || canChangeOwn ? (
          <div className="toolbar">
            {canAssign ? (
              <Field label="Agente">
                <Select value={agentId} onChange={(event) => setAgentId(event.target.value)}>
                  <option value={selfId}>Eu</option>
                  {agents.map((agent) => (
                    <option key={agent.agentId} value={agent.agentId}>{agent.name}</option>
                  ))}
                </Select>
              </Field>
            ) : null}
            <Field label="Atividade">
              <Select value={activityTypeId} onChange={(event) => setActivityTypeId(event.target.value)}>
                {types.filter((type) => type.active).map((type) => (
                  <option key={type.id} value={type.id}>{type.name}</option>
                ))}
              </Select>
            </Field>
            <Button icon={<Play size={16} />} onClick={() => void assign()} disabled={!activityTypeId}>Alocar</Button>
            <Button variant="secondary" icon={<Square size={16} />} onClick={() => void finish()}>Encerrar atividade</Button>
          </div>
        ) : (
          <p className="page__meta" data-testid="activity-locked">
            Seu perfil não permite registrar a própria atividade. A supervisão define pausas e outras atividades para você;
            peça a ela ou ao administrador se precisar registrar uma.
          </p>
        )}
      </Card>
      {isAdmin ? (
        <Card title="Catálogo de atividades" actions={<Button size="sm" icon={<Plus size={14} />} onClick={() => setTypeEditor({ type: null })}>Nova atividade</Button>}>
          <DataTable
            caption="Catálogo de atividades"
            columns={typeColumns}
            rows={types}
            rowKey={(type) => type.id}
            empty={<EmptyState icon={Activity} title="Nenhuma atividade" description="Cadastre tipos como reunião, treinamento ou pausa." />}
          />
        </Card>
      ) : null}
      <Card title="Histórico">
        <DataTable
          caption="Histórico de atividades"
          columns={historyColumns}
          rows={history}
          rowKey={(item) => item.id}
          empty={<EmptyState icon={Activity} title="Sem histórico" description="As atividades alocadas aparecem aqui." />}
        />
      </Card>
      <Modal open={typeEditor !== null} onClose={() => setTypeEditor(null)} title={typeEditor?.type ? 'Editar atividade' : 'Nova atividade'}>
        {typeEditor ? (
          <TypeForm
            socket={socket}
            type={typeEditor.type}
            onClose={() => setTypeEditor(null)}
            onSaved={(saved) => {
              setTypes((list) => [...list.filter((type) => type.id !== saved.id), saved].sort((a, b) => a.name.localeCompare(b.name)));
              setActivityTypeId((value) => value || (saved.active ? saved.id : ''));
              toast.notify('ok', 'Tipo de atividade salvo');
            }}
          />
        ) : null}
      </Modal>
    </div>
  );
}

function TypeForm({
  socket,
  type,
  onClose,
  onSaved,
}: {
  socket: Socket | null;
  type: ActivityType | null;
  onClose: () => void;
  onSaved: (type: ActivityType) => void;
}) {
  const [name, setName] = useState(type?.name ?? '');
  const [active, setActive] = useState(type?.active ?? true);
  const [pending, setPending] = useState(false);
  const toast = useToast();

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!socket || pending) return;
    setPending(true);
    const ack = await emitAck(socket, 'activity.type.save', {
      ...(type ? { activityTypeId: type.id } : {}),
      name,
      active,
    });
    setPending(false);
    const value = typeof ack === 'object' && ack !== null && 'activityType' in ack ? ack.activityType : null;
    const parsed = activityTypeSchema.safeParse(value);
    if (!parsed.success) {
      toast.notify('error', ackMessage({ success: true, data: ack }, 'Tipo de atividade recusado'));
      return;
    }
    onSaved(parsed.data);
    onClose();
  }

  return (
    <form className="form-stack" onSubmit={(event) => void submit(event)}>
      <Field label="Nome">
        <Input value={name} onChange={(event) => setName(event.target.value)} maxLength={120} autoFocus />
      </Field>
      <label className="check">
        <input type="checkbox" checked={active} onChange={(event) => setActive(event.target.checked)} />
        Ativa (pode ser alocada)
      </label>
      <div className="form-actions">
        <Button variant="secondary" onClick={onClose}>Cancelar</Button>
        <Button type="submit" disabled={pending || !name.trim()}>{type ? 'Salvar tipo' : 'Criar tipo'}</Button>
      </div>
    </form>
  );
}
