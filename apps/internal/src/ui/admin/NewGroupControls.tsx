import { Plus, X } from 'lucide-react';
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import type { GroupConversation, Directory, Ilha, IlhaId, StaffUser, UserId } from '@viavoip/internal-domain';

export type GroupDraft = { title: string; memberIds: readonly UserId[]; ilhaId: IlhaId | null };

export function NewGroupControls({ ilhas, me, directory, onCreate }: {
  ilhas: readonly Ilha[]; me: StaffUser; directory: Directory; onCreate: (draft: GroupDraft) => Promise<boolean>;
}) {
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState('');
  const buttonRef = useRef<HTMLButtonElement>(null);
  const selectId = useId();
  const chosen = ilhas.find((ilha) => ilha.id === picked);
  const close = useCallback(() => {
    setOpen(false);
    requestAnimationFrame(() => { buttonRef.current?.focus(); });
  }, []);
  return (
    <div className="sidebar-groups" role="group" aria-label="Grupos">
      <div className="admin-field sidebar-groups-select">
        <label htmlFor={selectId}>Ilha do grupo</label>
        <select id={selectId} value={chosen?.id ?? ''} onChange={(event) => { setPicked(event.target.value); }}>
          <option value="">Sem ilha</option>
          {ilhas.map((ilha) => <option key={ilha.id} value={ilha.id}>{ilha.name}</option>)}
        </select>
      </div>
      <button ref={buttonRef} type="button" className="admin-new sidebar-groups-new" onClick={() => { setOpen(true); }}>
        <Plus size={16} strokeWidth={2} aria-hidden="true" /> Novo grupo
      </button>
      {open ? <GroupDialog me={me} directory={directory} ilha={chosen} onClose={close} onSave={onCreate} /> : null}
    </div>
  );
}

export function GroupDialog({ me, directory, ilha, group, readOnly = false, onClose, onSave }: {
  me: StaffUser; directory: Directory; ilha?: Ilha | undefined; group?: GroupConversation | undefined;
  readOnly?: boolean;
  onClose: () => void; onSave: (draft: GroupDraft) => Promise<boolean>;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const [step, setStep] = useState(group ? 2 : 0);
  const [title, setTitle] = useState(group?.title ?? '');
  const [selected, setSelected] = useState<readonly UserId[]>(() => group?.members ?? [me.id, ...Object.values(directory.users).filter((user) => user.active && user.tenantId === me.tenantId && user.role === 'agent' && ilha !== undefined && user.ilhaIds.includes(ilha.id)).map((user) => user.id)]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const candidates = Object.values(directory.users).filter((user) => user.tenantId === me.tenantId && (user.active || selected.includes(user.id)));
  useLayoutEffect(() => { dialogRef.current?.showModal(); closeRef.current?.focus(); }, []);
  useEffect(() => {
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); onClose(); } };
    window.addEventListener('keydown', key);
    return () => { window.removeEventListener('keydown', key); };
  }, [onClose]);
  const changeMember = (id: UserId, checked: boolean) => {
    setSelected((old) => checked ? [...old, id] : old.filter((member) => member !== id));
  };
  const save = async () => {
    if (!title.trim() || busy) { if (!title.trim()) setError('Informe o nome do grupo.'); return; }
    setBusy(true); setError('');
    try {
      if (await onSave({ title: title.trim(), memberIds: selected, ilhaId: group?.origin.kind === 'ilha' ? group.origin.ilhaId : ilha?.id ?? null })) onClose();
      else setError('Não foi possível salvar o grupo.');
    } catch { setError('Não foi possível salvar o grupo.'); }
    finally { setBusy(false); }
  };
  return (
    <dialog ref={dialogRef} className="new-conversation" aria-labelledby="group-dialog-title" onCancel={(event) => { event.preventDefault(); onClose(); }}>
      <div className="new-conversation-bar">
        <h2 id="group-dialog-title" className="new-conversation-title">{group ? readOnly ? 'Membros do grupo' : 'Editar grupo' : 'Novo grupo'}</h2>
        <button ref={closeRef} type="button" className="icon-button" aria-label="Fechar" onClick={onClose}><X size={20} aria-hidden="true" /></button>
      </div>
      {step === 0 ? <p>Ilha escolhida: {ilha?.name ?? 'Sem ilha'}.</p> : null}
      {step === 1 || group ? (
        <fieldset><legend>Membros do grupo</legend>{group?.origin.kind === 'ilha' ? <p>Os membros são sincronizados com a ilha e não podem ser editados aqui.</p> : null}
          {candidates.map((user) => <label key={user.id} className="admin-field"><input type="checkbox" checked={selected.includes(user.id)} disabled={readOnly || (group?.origin.kind === 'custom' && user.id === group.origin.createdBy) || group?.origin.kind === 'ilha' || (!group && user.id === me.id) || !user.active} onChange={(event) => { changeMember(user.id, event.target.checked); }} /> {user.name}</label>)}
        </fieldset>
      ) : null}
      {step === 2 ? <div className="admin-field"><label htmlFor="group-name">Nome do grupo</label><input id="group-name" value={title} readOnly={readOnly} onChange={(event) => { setTitle(event.target.value); }} maxLength={200} /></div> : null}
      {error ? <p role="alert">{error}</p> : null}
      <div className="new-conversation-bar">
        {!group && step > 0 ? <button type="button" onClick={() => { setStep(step - 1); }}>Voltar</button> : null}
        {readOnly ? null : step < 2 ? <button type="button" onClick={() => { setStep(step + 1); }}>Próximo</button> : <button type="button" disabled={busy} onClick={() => { void save(); }}>{group ? 'Salvar alterações' : 'Criar grupo'}</button>}
      </div>
    </dialog>
  );
}
