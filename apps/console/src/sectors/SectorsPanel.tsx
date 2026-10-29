import { sectorListAckSchema, sectorSaveAckSchema, type SectorSummary } from '@viavoip/protocol';
import { Network, Pencil, Plus, X } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import type { Socket } from 'socket.io-client';
import { ackMessage, emitAck } from '../realtime.js';
import { Button } from '../ui/Button.js';
import { Card } from '../ui/Card.js';
import { Modal } from '../ui/Dialog.js';
import { Field, Input, Select } from '../ui/Field.js';
import { EmptyState, LoadingState } from '../ui/states.js';
import { StatusBadge } from '../ui/StatusBadge.js';
import { useToast } from '../ui/Toast.js';
import { addableMembers, knownPeople, supervisorCandidates, type Person } from './people.js';

export function SectorsPanel({ socket, canManage }: { socket: Socket | null; canManage: boolean }) {
  const [sectors, setSectors] = useState<SectorSummary[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<SectorSummary | null>(null);
  const toast = useToast();

  useEffect(() => {
    if (!socket) return;
    const reload = () => {
      void emitAck(socket, 'sector.list', {}).then((ack) => {
        const parsed = sectorListAckSchema.safeParse(ack);
        if (!parsed.success || !parsed.data.ok) return;
        setSectors(parsed.data.sectors);
      });
    };
    socket.on('sector.updated', reload);
    socket.on('connect', reload);
    if (socket.connected) reload();
    return () => {
      socket.off('sector.updated', reload);
      socket.off('connect', reload);
    };
  }, [socket]);

  function replace(sector: SectorSummary) {
    setSectors((current) => {
      const list = current ?? [];
      return list.some((item) => item.id === sector.id) ? list.map((item) => (item.id === sector.id ? sector : item)) : [...list, sector];
    });
  }

  async function changeMember(sector: SectorSummary, person: Person, action: 'sector.member.add' | 'sector.member.remove') {
    if (!socket) return;
    const parsed = sectorSaveAckSchema.safeParse(await emitAck(socket, action, { sectorId: sector.id, agentId: person.agentId }));
    if (!parsed.success || !parsed.data.ok) {
      toast.notify('error', ackMessage(parsed, 'Alteração recusada'));
      return;
    }
    replace(parsed.data.sector);
    toast.notify('ok', action === 'sector.member.add' ? `${person.name} incluído em ${sector.name}` : `${person.name} removido de ${sector.name}`);
  }

  if (!sectors) return <LoadingState label="Carregando setores…" />;
  const people = knownPeople(sectors);

  return (
    <div className="page">
      <Card
        title="Setores"
        actions={canManage ? <Button size="sm" icon={<Plus size={14} />} onClick={() => setCreating(true)}>Novo setor</Button> : undefined}
      >
        {sectors.length === 0 ? (
          <EmptyState icon={Network} title="Nenhum setor" description={canManage ? 'Crie o primeiro setor para organizar equipes e anúncios.' : 'Você ainda não participa de nenhum setor.'} />
        ) : (
          <div className="card-grid">
            {sectors.map((sector) => (
              <SectorCard
                key={sector.id}
                sector={sector}
                people={people}
                onEdit={() => setEditing(sector)}
                onMember={(person, action) => void changeMember(sector, person, action)}
              />
            ))}
          </div>
        )}
      </Card>
      <CreateModal socket={socket} open={creating} onClose={() => setCreating(false)} onSaved={replace} />
      <EditModal socket={socket} sector={editing} people={people} onClose={() => setEditing(null)} onSaved={replace} />
    </div>
  );
}

function SectorCard({
  sector,
  people,
  onEdit,
  onMember,
}: {
  sector: SectorSummary;
  people: Person[];
  onEdit: () => void;
  onMember: (person: Person, action: 'sector.member.add' | 'sector.member.remove') => void;
}) {
  const [personId, setPersonId] = useState('');
  const candidates = addableMembers(sector, people);
  return (
    <article className="item-card">
      <header className="item-card__head">
        <div>
          <h3>{sector.name}</h3>
          {sector.description ? <p className="page__meta">{sector.description}</p> : null}
        </div>
        <StatusBadge tone={sector.active ? 'success' : 'neutral'} dot>{sector.active ? 'Ativo' : 'Inativo'}</StatusBadge>
      </header>
      <dl>
        <div>
          <dt>Responsáveis</dt>
          <dd>
            {sector.supervisors.length === 0 ? <span className="cell-muted">Nenhum</span> : (
              <span className="chip-list">{sector.supervisors.map((person) => <StatusBadge key={person.agentId} tone="info">{person.name}</StatusBadge>)}</span>
            )}
          </dd>
        </div>
        <div>
          <dt>Membros ({sector.members.length})</dt>
          <dd>
            {sector.members.length === 0 ? <span className="cell-muted">Nenhum</span> : (
              <span className="chip-list">
                {sector.members.map((person) => (
                  <span key={person.agentId} className="ui-badge ui-badge--neutral">
                    {person.name}
                    {sector.canManage ? (
                      <button type="button" className="ui-icon-button" style={{ width: 18, height: 18 }} aria-label={`Remover ${person.name}`} onClick={() => onMember(person, 'sector.member.remove')}>
                        <X size={12} aria-hidden="true" />
                      </button>
                    ) : null}
                  </span>
                ))}
              </span>
            )}
          </dd>
        </div>
      </dl>
      {sector.canManage ? (
        <>
          <div className="toolbar">
            <Field label="Incluir pessoa">
              <Select value={personId} onChange={(event) => setPersonId(event.target.value)}>
                <option value="">Escolha uma pessoa</option>
                {candidates.map((person) => <option key={person.agentId} value={person.agentId}>{person.name}</option>)}
              </Select>
            </Field>
            <Button
              size="sm"
              variant="secondary"
              disabled={!personId}
              onClick={() => {
                const person = candidates.find((item) => item.agentId === personId);
                if (person) onMember(person, 'sector.member.add');
                setPersonId('');
              }}
            >
              Incluir
            </Button>
          </div>
          <div className="item-card__foot">
            <span />
            <Button size="sm" variant="ghost" icon={<Pencil size={14} />} onClick={onEdit}>Editar setor</Button>
          </div>
        </>
      ) : null}
    </article>
  );
}

function CreateModal({ socket, open, onClose, onSaved }: { socket: Socket | null; open: boolean; onClose: () => void; onSaved: (sector: SectorSummary) => void }) {
  return (
    <Modal open={open} onClose={onClose} title="Novo setor">
      <CreateForm socket={socket} onClose={onClose} onSaved={onSaved} />
    </Modal>
  );
}

function CreateForm({ socket, onClose, onSaved }: { socket: Socket | null; onClose: () => void; onSaved: (sector: SectorSummary) => void }) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [pending, setPending] = useState(false);
  const toast = useToast();
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!socket || pending) return;
    setPending(true);
    const parsed = sectorSaveAckSchema.safeParse(await emitAck(socket, 'sector.save', { name, description }));
    setPending(false);
    if (!parsed.success || !parsed.data.ok) {
      toast.notify('error', ackMessage(parsed, 'Não foi possível salvar o setor'));
      return;
    }
    onSaved(parsed.data.sector);
    toast.notify('ok', 'Setor salvo');
    onClose();
  }
  return (
    <form className="form-stack" onSubmit={(event) => void submit(event)}>
      <Field label="Nome">
        <Input data-testid="sector-name" value={name} onChange={(event) => setName(event.target.value)} maxLength={120} autoFocus />
      </Field>
      <Field label="Descrição">
        <Input value={description} onChange={(event) => setDescription(event.target.value)} maxLength={500} />
      </Field>
      <div className="form-actions">
        <Button variant="secondary" onClick={onClose}>Cancelar</Button>
        <Button type="submit" disabled={pending || !name.trim()}>Criar setor</Button>
      </div>
    </form>
  );
}

function EditModal({
  socket,
  sector,
  people,
  onClose,
  onSaved,
}: {
  socket: Socket | null;
  sector: SectorSummary | null;
  people: Person[];
  onClose: () => void;
  onSaved: (sector: SectorSummary) => void;
}) {
  return (
    <Modal open={sector !== null} onClose={onClose} title="Editar setor" size="lg">
      {sector ? <EditForm socket={socket} sector={sector} people={people} onClose={onClose} onSaved={onSaved} /> : null}
    </Modal>
  );
}

function EditForm({
  socket,
  sector,
  people,
  onClose,
  onSaved,
}: {
  socket: Socket | null;
  sector: SectorSummary;
  people: Person[];
  onClose: () => void;
  onSaved: (sector: SectorSummary) => void;
}) {
  const [name, setName] = useState(sector.name);
  const [description, setDescription] = useState(sector.description);
  const [active, setActive] = useState(sector.active);
  const [supervisorIds, setSupervisorIds] = useState<string[]>(sector.supervisors.map((person) => person.agentId));
  const [pending, setPending] = useState(false);
  const toast = useToast();
  const candidates = supervisorCandidates(sector, people);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!socket || pending) return;
    setPending(true);
    const parsed = sectorSaveAckSchema.safeParse(
      await emitAck(socket, 'sector.save', { sectorId: sector.id, name, description, active, supervisorIds }),
    );
    setPending(false);
    if (!parsed.success || !parsed.data.ok) {
      toast.notify('error', ackMessage(parsed, 'Não foi possível atualizar o setor'));
      return;
    }
    onSaved(parsed.data.sector);
    toast.notify('ok', 'Setor atualizado');
    onClose();
  }

  return (
    <form className="form-stack" onSubmit={(event) => void submit(event)}>
      <div className="form-grid">
        <Field label="Nome">
          <Input value={name} onChange={(event) => setName(event.target.value)} maxLength={120} />
        </Field>
        <Field label="Descrição">
          <Input value={description} onChange={(event) => setDescription(event.target.value)} maxLength={500} />
        </Field>
      </div>
      <fieldset className="form-stack" style={{ border: 0, padding: 0, margin: 0 }}>
        <legend className="ui-field__label">Responsáveis</legend>
        {candidates.length === 0 ? <p className="page__meta">Nenhum supervisor disponível.</p> : null}
        {candidates.map((person) => (
          <label key={person.agentId} className="check">
            <input
              type="checkbox"
              checked={supervisorIds.includes(person.agentId)}
              onChange={(event) =>
                setSupervisorIds((current) => (event.target.checked ? [...current, person.agentId] : current.filter((id) => id !== person.agentId)))
              }
            />
            {person.name}
          </label>
        ))}
      </fieldset>
      <label className="check">
        <input type="checkbox" checked={active} onChange={(event) => setActive(event.target.checked)} />
        Setor ativo
      </label>
      <div className="form-actions">
        <Button variant="secondary" onClick={onClose}>Cancelar</Button>
        <Button type="submit" disabled={pending || !name.trim()}>Salvar alterações</Button>
      </div>
    </form>
  );
}
