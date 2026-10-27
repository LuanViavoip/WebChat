import { sectorListAckSchema, sectorSaveAckSchema, type SectorSummary } from '@viavoip/protocol';
import { useEffect, useState, type FormEvent } from 'react';
import type { Socket } from 'socket.io-client';
import { ackMessage, emitAck } from '../realtime.js';

export function SectorsPanel({ socket, canManage }: { socket: Socket | null; canManage: boolean }) {
  const [sectors, setSectors] = useState<SectorSummary[]>([]);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [agentId, setAgentId] = useState('');
  const [selectedId, setSelectedId] = useState('');
  const [notice, setNotice] = useState('');
  const [editingId, setEditingId] = useState('');
  const [editName, setEditName] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editActive, setEditActive] = useState(true);
  const [editSupervisorIds, setEditSupervisorIds] = useState('');

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

  async function createSector(event: FormEvent) {
    event.preventDefault();
    if (!socket) return;
    const parsed = sectorSaveAckSchema.safeParse(
      await emitAck(socket, 'sector.save', { name, description }),
    );
    if (!parsed.success || !parsed.data.ok) {
      setNotice(ackMessage(parsed, 'Não foi possível salvar o setor'));
      return;
    }
    const sector = parsed.data.sector;
    setName('');
    setDescription('');
    setNotice('Setor salvo');
    setSectors((current) => [...current.filter((item) => item.id !== sector.id), sector]);
  }

  async function changeMember(action: 'sector.member.add' | 'sector.member.remove') {
    if (!socket || !selectedId || !agentId) return;
    const parsed = sectorSaveAckSchema.safeParse(await emitAck(socket, action, { sectorId: selectedId, agentId }));
    if (!parsed.success || !parsed.data.ok) {
      setNotice(ackMessage(parsed, 'Alteração recusada'));
      return;
    }
    const sector = parsed.data.sector;
    setSectors((current) => current.map((item) => (item.id === sector.id ? sector : item)));
    setNotice(action === 'sector.member.add' ? 'Membro incluído' : 'Membro removido');
  }

  function beginEdit(sector: SectorSummary) {
    setEditingId(sector.id);
    setEditName(sector.name);
    setEditDescription(sector.description);
    setEditActive(sector.active);
    setEditSupervisorIds(sector.supervisors.map((person) => person.agentId).join(', '));
  }

  async function saveSector(event: FormEvent) {
    event.preventDefault();
    if (!socket || !editingId) return;
    const supervisorIds = editSupervisorIds.split(',').map((id) => id.trim()).filter(Boolean);
    const parsed = sectorSaveAckSchema.safeParse(await emitAck(socket, 'sector.save', {
      sectorId: editingId,
      name: editName,
      description: editDescription,
      active: editActive,
      supervisorIds,
    }));
    if (!parsed.success || !parsed.data.ok) {
      setNotice(ackMessage(parsed, 'Não foi possível atualizar o setor'));
      return;
    }
    const savedSector = parsed.data.sector;
    setSectors((current) => current.map((sector) => sector.id === editingId ? savedSector : sector));
    setEditingId('');
    setNotice('Setor atualizado');
  }

  return (
    <section className="panel">
      <h2>Setores</h2>
      {notice ? <p className="ok">{notice}</p> : null}
      {canManage ? (
        <form onSubmit={(event) => void createSector(event)}>
          <label>
            Nome
            <input data-testid="sector-name" value={name} onChange={(event) => setName(event.target.value)} />
          </label>
          <label>
            Descrição
            <input value={description} onChange={(event) => setDescription(event.target.value)} />
          </label>
          <button type="submit">Criar setor</button>
        </form>
      ) : null}
      {sectors.map((sector) => (
        <article key={sector.id} className="pane">
          <h3>{sector.name}</h3>
          <p className="muted">{sector.active ? 'Ativo' : 'Inativo'} · {sector.description}</p>
          <p>Membros: {sector.members.map((member) => member.name).join(', ') || 'nenhum'}</p>
          <p>Responsáveis: {sector.supervisors.map((person) => person.name).join(', ') || 'nenhum'}</p>
          {sector.canManage ? (
            <>
              {editingId === sector.id ? (
                <form className="stack" onSubmit={(event) => void saveSector(event)}>
                  <label>Nome<input value={editName} onChange={(event) => setEditName(event.target.value)} /></label>
                  <label>Descrição<input value={editDescription} onChange={(event) => setEditDescription(event.target.value)} /></label>
                  <label>
                    Responsáveis (IDs separados por vírgula)
                    <input value={editSupervisorIds} onChange={(event) => setEditSupervisorIds(event.target.value)} />
                  </label>
                  <label><input type="checkbox" checked={editActive} onChange={(event) => setEditActive(event.target.checked)} /> Setor ativo</label>
                  <button type="submit">Salvar alterações</button>
                  <button type="button" onClick={() => setEditingId('')}>Cancelar</button>
                </form>
              ) : (
                <button type="button" onClick={() => beginEdit(sector)}>Editar setor e responsáveis</button>
              )}
              <div className="stack">
                <input
                  placeholder="Id do agente"
                  value={selectedId === sector.id ? agentId : ''}
                  onChange={(event) => {
                    setSelectedId(sector.id);
                    setAgentId(event.target.value);
                  }}
                />
                <button type="button" onClick={() => void changeMember('sector.member.add')}>Incluir</button>
                <button type="button" onClick={() => void changeMember('sector.member.remove')}>Remover</button>
              </div>
            </>
          ) : null}
        </article>
      ))}
    </section>
  );
}
