import type { ActivityAuthority, AgentAdmin, AgentPlacement, Role } from '@viavoip/protocol';
import { KeyRound, LogOut, Pencil, Plus, UserX } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { roleLabel } from '../../shell/roles.js';
import { Avatar } from '../../ui/Avatar.js';
import { Button } from '../../ui/Button.js';
import { Card } from '../../ui/Card.js';
import { DataTable, type Column } from '../../ui/DataTable.js';
import { Field, Input, Select, Textarea } from '../../ui/Field.js';
import { EmptyState } from '../../ui/states.js';
import { StatusBadge } from '../../ui/StatusBadge.js';
import { useAdminCommand, type AdminContext } from '../AdminContext.js';
import { CommandConfirm, FormModal, InstantAction, useFormId, useModalForm } from '../parts.js';
import { editCommands, placementOf, type AgentDraft } from '../users.js';

type Dialog =
  | { kind: 'create' }
  | { kind: 'edit'; agent: AgentAdmin }
  | { kind: 'suspend'; agent: AgentAdmin }
  | { kind: 'revoke'; agent: AgentAdmin }
  | { kind: 'password'; agent: AgentAdmin };

export function UsersSection({ ctx }: { ctx: AdminContext }) {
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const close = () => setDialog(null);
  const queueName = (id: string) => ctx.desk.queues.find((queue) => queue.id === id)?.name ?? 'Fila removida';
  const columns: Column<AgentAdmin>[] = [
    {
      key: 'name',
      header: 'Usuário',
      render: (agent) => (
        <span className="cell-person">
          <Avatar name={agent.name} size={32} />
          <span>
            {agent.name}
            <br />
            <small className="cell-muted">{agent.email}</small>
          </span>
        </span>
      ),
    },
    { key: 'role', header: 'Papel', render: (agent) => <StatusBadge tone={agent.placement.role === 'admin' ? 'info' : 'neutral'}>{roleLabel(agent.placement.role)}</StatusBadge> },
    {
      key: 'queues',
      header: 'Filas',
      render: (agent) =>
        agent.placement.role === 'agent' && agent.placement.queueIds.length > 0 ? (
          <span className="chip-list">
            {agent.placement.queueIds.map((id) => <StatusBadge key={id}>{queueName(id)}</StatusBadge>)}
          </span>
        ) : (
          <span className="cell-muted">{agent.placement.role === 'agent' ? 'Nenhuma' : '—'}</span>
        ),
    },
    {
      key: 'activity',
      header: 'Registra atividades',
      render: (agent) => {
        if (agent.placement.role !== 'agent') return <span className="cell-muted">—</span>;
        return agent.placement.activityAuthority.kind === 'self_service' ? (
          <StatusBadge tone="info">O próprio agente</StatusBadge>
        ) : (
          <StatusBadge>A supervisão</StatusBadge>
        );
      },
    },
    {
      key: 'status',
      header: 'Situação',
      render: (agent) =>
        agent.membership.status === 'active' ? (
          <StatusBadge tone="success" dot>Ativo</StatusBadge>
        ) : (
          <span title={agent.membership.reason}><StatusBadge tone="error" dot>Suspenso</StatusBadge></span>
        ),
    },
    {
      key: 'actions',
      header: 'Ações',
      align: 'end',
      render: (agent) => (
        <span className="row-actions">
          <Button size="sm" variant="secondary" icon={<Pencil size={14} />} onClick={() => setDialog({ kind: 'edit', agent })}>Editar</Button>
          {agent.membership.status === 'active' ? (
            <Button size="sm" variant="ghost" icon={<UserX size={14} />} aria-label={`Suspender ${agent.name}`} title="Suspender" onClick={() => setDialog({ kind: 'suspend', agent })} />
          ) : (
            <InstantAction ctx={ctx} label="Reativar" command={{ kind: 'agent.reactivate', agentId: agent.agentId }} success={`${agent.name} reativado`} />
          )}
          <Button size="sm" variant="ghost" icon={<LogOut size={14} />} aria-label={`Revogar sessões de ${agent.name}`} title="Revogar sessões" onClick={() => setDialog({ kind: 'revoke', agent })} />
          <Button size="sm" variant="ghost" icon={<KeyRound size={14} />} aria-label={`Redefinir senha de ${agent.name}`} title="Redefinir senha" onClick={() => setDialog({ kind: 'password', agent })} />
        </span>
      ),
    },
  ];
  const agent = dialog && dialog.kind !== 'create' ? dialog.agent : null;
  return (
    <Card
      title="Usuários e permissões"
      actions={<Button size="sm" icon={<Plus size={14} />} onClick={() => setDialog({ kind: 'create' })}>Novo usuário</Button>}
    >
      <DataTable
        caption="Usuários"
        columns={columns}
        rows={ctx.desk.agents}
        rowKey={(item) => item.agentId}
        empty={<EmptyState title="Nenhum usuário" description="Crie o primeiro usuário da empresa." />}
      />
      <UserModal ctx={ctx} open={dialog?.kind === 'create' || dialog?.kind === 'edit'} agent={dialog?.kind === 'edit' ? dialog.agent : null} onClose={close} />
      <SuspendModal ctx={ctx} agent={dialog?.kind === 'suspend' ? dialog.agent : null} onClose={close} />
      <PasswordModal ctx={ctx} agent={dialog?.kind === 'password' ? dialog.agent : null} onClose={close} />
      <CommandConfirm
        ctx={ctx}
        open={dialog?.kind === 'revoke'}
        title="Revogar sessões?"
        description={`${agent?.name ?? 'O usuário'} será desconectado de todos os dispositivos e precisará entrar de novo.`}
        confirmLabel="Revogar sessões"
        command={{ kind: 'agent.sessions_revoke', agentId: agent?.agentId ?? '' }}
        success={`Sessões de ${agent?.name ?? 'usuário'} revogadas`}
        onClose={close}
      />
    </Card>
  );
}

function UserModal({ ctx, open, agent, onClose }: { ctx: AdminContext; open: boolean; agent: AgentAdmin | null; onClose: () => void }) {
  const formId = useFormId();
  return (
    <FormModal open={open} title={agent ? `Editar ${agent.name}` : 'Novo usuário'} formId={formId} submitLabel={agent ? 'Salvar' : 'Criar usuário'} wide onClose={onClose}>
      <UserForm ctx={ctx} formId={formId} agent={agent} onDone={onClose} />
    </FormModal>
  );
}

function UserForm({ ctx, formId, agent, onDone }: { ctx: AdminContext; formId: string; agent: AgentAdmin | null; onDone: () => void }) {
  const initial: AgentPlacement = agent?.placement ?? { role: 'agent', queueIds: [], activityAuthority: { kind: 'assigned_only' } };
  const [email, setEmail] = useState(agent?.email ?? '');
  const [name, setName] = useState(agent?.name ?? '');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<Role>(initial.role);
  const [queueIds, setQueueIds] = useState<string[]>(initial.role === 'agent' ? initial.queueIds : []);
  const [authority, setAuthority] = useState<ActivityAuthority['kind']>(initial.role === 'agent' ? initial.activityAuthority.kind : 'assigned_only');
  const action = useAdminCommand(ctx);
  useModalForm(action);
  const draft: AgentDraft = { role, queueIds, authority };

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!agent) {
      const ok = await action.submit(
        { kind: 'agent.create', email, name, password, placement: placementOf(draft) },
        `${name.trim()} criado`,
      );
      if (ok) onDone();
      return;
    }
    // Usa o estado mais recente da empresa: se um comando anterior já foi aplicado, ele não é repetido.
    const live = ctx.desk.agents.find((item) => item.agentId === agent.agentId) ?? agent;
    const commands = editCommands(live, draft);
    if (commands.length === 0) {
      onDone();
      return;
    }
    // Cada comando é aplicado em sequência; se um falhar, os já aplicados não se repetem ao reenviar.
    for (const command of commands) {
      const ok = await action.submit(command, `${agent.name} atualizado`);
      if (!ok) return;
    }
    onDone();
  }

  function toggleQueue(id: string, checked: boolean) {
    setQueueIds((current) => (checked ? [...current, id] : current.filter((item) => item !== id)));
  }

  return (
    <form id={formId} className="form-stack" onSubmit={(event) => void submit(event)}>
      {!agent ? (
        <div className="form-grid">
          <Field label="Nome">
            <Input value={name} onChange={(event) => setName(event.target.value)} maxLength={120} autoFocus />
          </Field>
          <Field label="E-mail">
            <Input type="email" value={email} onChange={(event) => setEmail(event.target.value)} maxLength={200} autoComplete="off" />
          </Field>
          <Field label="Senha inicial" hint="Mínimo de 12 caracteres.">
            <Input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="new-password" />
          </Field>
        </div>
      ) : null}
      <Field label="Papel">
        <Select value={role} onChange={(event) => setRole(event.target.value === 'admin' ? 'admin' : event.target.value === 'supervisor' ? 'supervisor' : 'agent')}>
          <option value="agent">Agente</option>
          <option value="supervisor">Supervisor</option>
          <option value="admin">Administração</option>
        </Select>
      </Field>
      {role === 'agent' ? (
        <>
          <fieldset className="form-stack" style={{ border: 0, padding: 0, margin: 0 }}>
            <legend className="ui-field__label">Filas de atendimento</legend>
            {ctx.desk.queues.length === 0 ? <p className="page__meta">Nenhuma fila cadastrada.</p> : null}
            {ctx.desk.queues.map((queue) => (
              <label key={queue.id} className="check">
                <input type="checkbox" checked={queueIds.includes(queue.id)} onChange={(event) => toggleQueue(queue.id, event.target.checked)} />
                {queue.name}
              </label>
            ))}
          </fieldset>
          <Field label="Atividades" hint="Quem registra as pausas e outras atividades do agente (reunião, treinamento etc.). Ao mudar, a pessoa precisa entrar de novo.">
            <Select value={authority} onChange={(event) => setAuthority(event.target.value === 'self_service' ? 'self_service' : 'assigned_only')}>
              <option value="assigned_only">Somente a supervisão define</option>
              <option value="self_service">O agente registra a própria atividade</option>
            </Select>
          </Field>
        </>
      ) : null}
      {action.error ? <p className="form-error" role="alert">{action.error}</p> : null}
    </form>
  );
}

function SuspendModal({ ctx, agent, onClose }: { ctx: AdminContext; agent: AgentAdmin | null; onClose: () => void }) {
  const formId = useFormId();
  return (
    <FormModal open={agent !== null} title="Suspender usuário" formId={formId} submitLabel="Suspender" danger onClose={onClose}>
      {agent ? <SuspendForm ctx={ctx} formId={formId} agent={agent} onDone={onClose} /> : null}
    </FormModal>
  );
}

function SuspendForm({ ctx, formId, agent, onDone }: { ctx: AdminContext; formId: string; agent: AgentAdmin; onDone: () => void }) {
  const [reason, setReason] = useState('');
  const action = useAdminCommand(ctx);
  useModalForm(action);
  async function submit(event: FormEvent) {
    event.preventDefault();
    const ok = await action.submit({ kind: 'agent.suspend', agentId: agent.agentId, reason }, `${agent.name} suspenso`);
    if (ok) onDone();
  }
  return (
    <form id={formId} className="form-stack" onSubmit={(event) => void submit(event)}>
      <p>{agent.name} perde o acesso e as sessões abertas são encerradas. É possível reativar depois.</p>
      <Field label="Motivo da suspensão">
        <Textarea rows={3} value={reason} onChange={(event) => setReason(event.target.value)} maxLength={200} autoFocus />
      </Field>
      {action.error ? <p className="form-error" role="alert">{action.error}</p> : null}
    </form>
  );
}

function PasswordModal({ ctx, agent, onClose }: { ctx: AdminContext; agent: AgentAdmin | null; onClose: () => void }) {
  const formId = useFormId();
  return (
    <FormModal open={agent !== null} title="Redefinir senha" formId={formId} submitLabel="Redefinir" onClose={onClose}>
      {agent ? <PasswordForm ctx={ctx} formId={formId} agent={agent} onDone={onClose} /> : null}
    </FormModal>
  );
}

function PasswordForm({ ctx, formId, agent, onDone }: { ctx: AdminContext; formId: string; agent: AgentAdmin; onDone: () => void }) {
  const [password, setPassword] = useState('');
  const action = useAdminCommand(ctx);
  useModalForm(action);
  async function submit(event: FormEvent) {
    event.preventDefault();
    const ok = await action.submit({ kind: 'agent.credential_reset', agentId: agent.agentId, password }, `Senha de ${agent.name} redefinida`);
    if (ok) onDone();
  }
  return (
    <form id={formId} className="form-stack" onSubmit={(event) => void submit(event)}>
      <p>Defina uma nova senha para {agent.name}. Combine a entrega da senha por um canal seguro.</p>
      <Field label="Nova senha" hint="Mínimo de 12 caracteres.">
        <Input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="new-password" autoFocus />
      </Field>
      {action.error ? <p className="form-error" role="alert">{action.error}</p> : null}
    </form>
  );
}
