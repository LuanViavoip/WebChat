import { ArrowLeft } from 'lucide-react';
import { useId, useRef, useState, type SyntheticEvent, type ReactNode } from 'react';
import type { Capability } from '../../domain/capabilities';
import {
  canManageIlhasIn,
  canMoveAgentIn,
  canSetActiveIn,
  describeDenial,
} from '../../domain/directoryOps';
import type { Ilha, StaffUser } from '../../domain/identity';
import { own } from '../../domain/records';
import { conversationInitials, roleLabel } from '../conversations';
import { capabilityLabel } from './capabilityLabels';
import { SelectField, TextField } from './forms';
import { byName, nameProblem } from './helpers';
import { GrantLogList } from './GrantLogList';
import { PermissionsPanel } from './PermissionsPanel';
import type { ConsoleContext } from './types';

function HeaderTitle({ level, id, children }: { level: 1 | 2; id: string; children: string }) {
  return level === 1 ? (
    <h1 id={id} className="header-title">
      {children}
    </h1>
  ) : (
    <h2 id={id} className="header-title">
      {children}
    </h2>
  );
}

/** Foco por teclado numa região rolável (WCAG 2.1.1; axe `scrollable-region-focusable`): vale mesmo sem controle habilitado dentro. */
export const SCROLL_FOCUSABLE = { tabIndex: 0 } as const;

/** Região rolável do detalhe: focalizável (teclado rola mesmo sem controle habilitado) e com nome. */
export function DetailScroll({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="admin-detail-scroll" role="region" aria-label={label} {...SCROLL_FOCUSABLE}>
      {children}
    </div>
  );
}

export function DetailHeader({
  title,
  subtitle,
  titleId,
  onBack,
  level,
}: {
  title: string;
  subtitle?: string;
  titleId: string;
  onBack: () => void;
  /** No mobile o painel de detalhe é a tela inteira, então o título dele é o h1. */
  level: 1 | 2;
}) {
  return (
    <header className="chat-header" tabIndex={-1} data-detail-header>
      <button type="button" className="icon-button header-back admin-detail-back" aria-label="Voltar" onClick={onBack}>
        <ArrowLeft size={20} strokeWidth={1.7} aria-hidden="true" />
      </button>
      <div className="avatar avatar-contact" aria-hidden="true">
        {conversationInitials(title)}
      </div>
      <div className="header-identity">
        <HeaderTitle level={level} id={titleId}>
          {title}
        </HeaderTitle>
        {subtitle ? <p className="header-status">{subtitle}</p> : null}
      </div>
    </header>
  );
}

function Block({ title, children }: { title: string; children: ReactNode }) {
  const id = useId();
  return (
    <section className="admin-block" aria-labelledby={id}>
      <h3 id={id} className="admin-h3">
        {title}
      </h3>
      {children}
    </section>
  );
}

export function NewDetailHeader({ title, onBack, level }: { title: string; onBack: () => void; level: 1 | 2 }) {
  return <DetailHeader title={title} titleId="admin-detail-title" onBack={onBack} level={level} />;
}

export function UserDetail({
  ctx,
  target,
  onBack,
  level,
}: {
  ctx: ConsoleContext;
  target: StaffUser;
  onBack: () => void;
  level: 1 | 2;
}) {
  const { me, directory } = ctx;
  const isSelf = target.id === me.id;
  const ilhaName = target.role === 'agent' ? own(directory.ilhas, target.ilhaId)?.name : undefined;
  const supervised =
    target.role === 'supervisor' ? byName(Object.values(directory.ilhas).filter((ilha) => ilha.supervisorId === target.id)) : [];
  const [pending, setPending] = useState<ReadonlySet<Capability>>(new Set());

  const activeVerdict = canSetActiveIn(directory, me.id, target.id);
  const activeReasonId = useId();

  const moveOptions =
    target.role === 'agent'
      ? byName(
          Object.values(directory.ilhas).filter(
            (ilha) => ilha.id !== target.ilhaId && canMoveAgentIn(directory, me.id, target.id, ilha.id).ok,
          ),
        )
      : [];

  async function toggle(capability: Capability, next: boolean) {
    setPending((current) => new Set([...current, capability]));
    await ctx.perform(
      () => ctx.actions.setGrant(target.id, capability, next),
      () => `${capabilityLabel(capability)} ${next ? 'ligada' : 'desligada'} para ${target.name}.`,
    );
    setPending((current) => new Set([...current].filter((item) => item !== capability)));
  }

  const subtitle = [roleLabel(target.role), ilhaName ? `Ilha ${ilhaName}` : undefined, target.active ? 'Ativo' : 'Desativado']
    .filter((part) => part !== undefined)
    .join(' · ');

  return (
    <>
      <DetailHeader title={isSelf ? `${target.name} (você)` : target.name} subtitle={subtitle} titleId="admin-detail-title" onBack={onBack} level={level} />
      <DetailScroll label={`Detalhes de ${target.name}`}>
        {isSelf ? (
          <p className="admin-note">Você vê suas próprias permissões, mas não pode alterá-las.</p>
        ) : (
          <Block title="Conta">
            <p className="admin-muted">
              {target.active ? 'A conta está ativa.' : 'A conta está desativada: não entra no chat e o histórico fica guardado.'}
            </p>
            <button
              type="button"
              className="admin-secondary"
              disabled={!activeVerdict.ok || ctx.busy}
              {...(!activeVerdict.ok ? { 'aria-describedby': activeReasonId } : {})}
              onClick={() => {
                void ctx.perform(
                  () => (target.active ? ctx.actions.deactivateUser(target.id) : ctx.actions.reactivateUser(target.id)),
                  (user) => `${user.name} ${user.active ? 'reativado' : 'desativado'}.`,
                );
              }}
            >
              {target.active ? 'Desativar' : 'Reativar'}
            </button>
            {!activeVerdict.ok ? (
              <p id={activeReasonId} className="perm-reason">
                {describeDenial(activeVerdict.error)}
              </p>
            ) : null}
          </Block>
        )}
        {target.role === 'supervisor' ? (
          <Block title="Ilhas">
            {supervised.length > 0 ? (
              <ul className="admin-chips" aria-label={`Ilhas de ${target.name}`}>
                {supervised.map((ilha) => (
                  <li key={ilha.id}>{ilha.name}</li>
                ))}
              </ul>
            ) : (
              <p className="admin-muted">Não supervisiona nenhuma ilha.</p>
            )}
          </Block>
        ) : null}
        {target.role === 'agent' && !isSelf ? <MoveAgentBlock ctx={ctx} agent={target} options={moveOptions} /> : null}
        <Block title="Permissões">
          <PermissionsPanel
            directory={directory}
            actor={me}
            target={target}
            pending={pending}
            busy={ctx.busy}
            onToggle={(capability, next) => {
              void toggle(capability, next);
            }}
          />
        </Block>
        <Block title="Registro desta pessoa">
          <GrantLogList
            entries={ctx.grantLog}
            directory={directory}
            timeZone={ctx.timeZone}
            onlyTarget={target.id}
            label={`Registro de permissões de ${target.name}`}
          />
        </Block>
      </DetailScroll>
    </>
  );
}

function MoveAgentBlock({ ctx, agent, options }: { ctx: ConsoleContext; agent: StaffUser; options: readonly Ilha[] }) {
  const [picked, setPicked] = useState('');
  const ilhaId = options.some((ilha) => ilha.id === picked) ? picked : (options[0]?.id ?? '');
  async function submit(event: SyntheticEvent) {
    event.preventDefault();
    const destination = options.find((ilha) => ilha.id === ilhaId);
    if (!destination) {
      return;
    }
    await ctx.perform(
      () => ctx.actions.moveAgent(agent.id, destination.id),
      () => `${agent.name} movido para a ilha ${destination.name}.`,
    );
  }
  return (
    <Block title="Ilha do agente">
      {options.length === 0 ? (
        <p className="admin-muted">Não há outra ilha disponível para mover este agente.</p>
      ) : (
        <form
          className="admin-inline-form"
          onSubmit={(event) => {
            void submit(event);
          }}
        >
          <SelectField
            label="Mover para a ilha"
            value={ilhaId}
            onChange={setPicked}
            options={options.map((ilha) => ({ value: ilha.id, label: ilha.name }))}
          />
          <button type="submit" className="admin-secondary" disabled={ctx.busy}>
            Mover
          </button>
        </form>
      )}
    </Block>
  );
}

export function IlhaDetail({ ctx, ilha, onBack, level }: { ctx: ConsoleContext; ilha: Ilha; onBack: () => void; level: 1 | 2 }) {
  const { directory, me } = ctx;
  const allowed = canManageIlhasIn(directory, me.id);
  const supervisors = byName(Object.values(directory.users).filter((user) => user.role === 'supervisor' && user.active));
  const agents = byName(Object.values(directory.users).filter((user) => user.role === 'agent' && user.ilhaId === ilha.id));
  const current = own(directory.users, ilha.supervisorId);
  // `null` = o campo ainda não foi editado: mostra o que o servidor tem (acompanha renomeação de outra aba).
  // Editado, mantém o texto de quem digita.
  const [draft, setDraft] = useState<string | null>(null);
  const [pickedSupervisor, setPickedSupervisor] = useState<string | null>(null);
  const name = draft ?? ilha.name;
  const setName = (value: string) => {
    setDraft(value);
  };
  const picked = pickedSupervisor ?? ilha.supervisorId;
  const setPicked = (value: string) => {
    setPickedSupervisor(value);
  };
  const nameRef = useRef<HTMLInputElement>(null);
  const supervisorId = supervisors.some((user) => user.id === picked) ? picked : (supervisors[0]?.id ?? '');
  const reasonId = useId();

  async function rename(event: SyntheticEvent) {
    event.preventDefault();
    const problem = nameProblem(name);
    if (problem) {
      ctx.fail(problem);
      nameRef.current?.focus();
      return;
    }
    const result = await ctx.perform(
      () => ctx.actions.renameIlha(ilha.id, name),
      (renamed) => `Ilha renomeada para ${renamed.name}.`,
    );
    if (result.ok) {
      setDraft(null);
    }
  }

  async function assign(event: SyntheticEvent) {
    event.preventDefault();
    const chosen = supervisors.find((user) => user.id === supervisorId);
    if (!chosen) {
      return;
    }
    const result = await ctx.perform(
      () => ctx.actions.assignIlhaSupervisor(ilha.id, chosen.id),
      () => `${chosen.name} agora supervisiona a ilha ${ilha.name}.`,
    );
    if (result.ok) {
      setPickedSupervisor(null);
    }
  }

  return (
    <>
      <DetailHeader
        title={ilha.name}
        subtitle={`Supervisor: ${current?.name ?? 'sem supervisor'}`}
        titleId="admin-detail-title"
        onBack={onBack}
        level={level}
      />
      <DetailScroll label={`Detalhes da ilha ${ilha.name}`}>
        {!allowed.ok ? (
          <p id={reasonId} className="perm-reason">
            {describeDenial(allowed.error)}
          </p>
        ) : null}
        <Block title="Renomear">
          <form
            className="admin-inline-form"
            onSubmit={(event) => {
              void rename(event);
            }}
            noValidate
          >
            <TextField label="Nome da ilha" value={name} onChange={setName} inputRef={nameRef} />
            <button type="submit" className="admin-secondary" disabled={!allowed.ok || ctx.busy}>
              Renomear
            </button>
          </form>
        </Block>
        <Block title="Supervisor">
          {supervisors.length === 0 ? (
            <p className="admin-muted">Nenhum supervisor ativo disponível.</p>
          ) : (
            <form
              className="admin-inline-form"
              onSubmit={(event) => {
                void assign(event);
              }}
            >
              <SelectField
                label="Supervisor da ilha"
                value={supervisorId}
                onChange={setPicked}
                options={supervisors.map((user) => ({ value: user.id, label: user.name }))}
              />
              <button type="submit" className="admin-secondary" disabled={!allowed.ok || ctx.busy}>
                Atribuir supervisor
              </button>
            </form>
          )}
        </Block>
        <Block title="Agentes da ilha">
          {agents.length === 0 ? (
            <p className="admin-muted">Nenhum agente nesta ilha.</p>
          ) : (
            <ul className="admin-chips" aria-label={`Agentes da ilha ${ilha.name}`}>
              {agents.map((agent) => (
                <li key={agent.id}>{agent.active ? agent.name : `${agent.name} (desativado)`}</li>
              ))}
            </ul>
          )}
        </Block>
      </DetailScroll>
    </>
  );
}
