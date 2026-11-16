import { useId, useRef, useState, type SyntheticEvent, type ReactNode, type RefObject } from 'react';
import { canRegisterAgentIn, validName } from '../../domain/directoryOps';
import { byName, nameProblem } from './helpers';
import type { Ilha, IlhaId, StaffUser } from '../../domain/identity';
import type { ConsoleContext } from './types';

/** Campo de texto com rótulo. `autoFocusTarget` marca o campo que recebe o foco ao abrir o formulário. */
export function TextField({
  label,
  value,
  onChange,
  inputRef,
  focusTarget = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  inputRef?: RefObject<HTMLInputElement | null>;
  focusTarget?: boolean;
}) {
  const id = useId();
  return (
    <div className="admin-field">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        ref={inputRef}
        type="text"
        value={value}
        autoComplete="off"
        maxLength={120}
        {...(focusTarget ? { 'data-autofocus': '' } : {})}
        onChange={(event) => {
          onChange(event.target.value);
        }}
      />
    </div>
  );
}

export function SelectField({
  label,
  value,
  onChange,
  options,
  disabled = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: readonly { readonly value: string; readonly label: string }[];
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <div className="admin-field">
      <label htmlFor={id}>{label}</label>
      <select
        id={id}
        value={value}
        disabled={disabled}
        onChange={(event) => {
          onChange(event.target.value);
        }}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}

export function FormCard({
  title,
  onSubmit,
  children,
}: {
  title: string;
  onSubmit: (event: SyntheticEvent<HTMLFormElement>) => void;
  children: ReactNode;
}) {
  const titleId = useId();
  return (
    <form className="admin-form" aria-labelledby={titleId} onSubmit={onSubmit} noValidate>
      <h3 id={titleId} className="admin-h3">
        {title}
      </h3>
      {children}
    </form>
  );
}

/** Valida o nome, mostra o erro no alert e devolve o nome limpo (ou `undefined`, com o foco de volta no campo). */
function useNameCheck(ctx: ConsoleContext) {
  const ref = useRef<HTMLInputElement>(null);
  const check = (name: string): string | undefined => {
    const problem = nameProblem(name);
    if (problem) {
      ctx.fail(problem);
      ref.current?.focus();
      return undefined;
    }
    return validName(name);
  };
  return { ref, check };
}

export function NewSupervisorForm({ ctx, ilhas }: { ctx: ConsoleContext; ilhas: readonly Ilha[] }) {
  const [name, setName] = useState('');
  const [chosen, setChosen] = useState<readonly IlhaId[]>([]);
  const { ref, check } = useNameCheck(ctx);
  const legendId = useId();

  async function submit(event: SyntheticEvent) {
    event.preventDefault();
    const clean = check(name);
    if (!clean) {
      return;
    }
    const result = await ctx.perform(
      () => ctx.actions.registerSupervisor(clean, chosen),
      (user) => `Supervisor ${user.name} cadastrado.`,
    );
    if (result.ok) {
      ctx.select({ kind: 'user', id: result.value.id });
    }
  }

  return (
    <FormCard title="Cadastrar supervisor" onSubmit={(event) => void submit(event)}>
      <TextField label="Nome" value={name} onChange={setName} inputRef={ref} focusTarget />
      {ilhas.length > 0 ? (
        <fieldset className="admin-fieldset" aria-labelledby={legendId}>
          <legend id={legendId}>Ilhas que vai supervisionar (opcional)</legend>
          {byName(ilhas).map((ilha) => (
            <label key={ilha.id} className="admin-check">
              <input
                type="checkbox"
                checked={chosen.includes(ilha.id)}
                onChange={(event) => {
                  setChosen((current) => (event.target.checked ? [...current, ilha.id] : current.filter((id) => id !== ilha.id)));
                }}
              />
              <span>{ilha.name}</span>
            </label>
          ))}
        </fieldset>
      ) : null}
      <button type="submit" className="admin-primary" disabled={ctx.busy}>
        Cadastrar supervisor
      </button>
    </FormCard>
  );
}

export function NewAgentForm({ ctx }: { ctx: ConsoleContext }) {
  const [name, setName] = useState('');
  // Só as ilhas em que o predicado do domínio deixa cadastrar (supervisor: as dele).
  const options = byName(
    Object.values(ctx.directory.ilhas).filter((ilha) => canRegisterAgentIn(ctx.directory, ctx.me.id, ilha.id).ok),
  );
  const [picked, setPicked] = useState('');
  const ilhaId = options.some((ilha) => ilha.id === picked) ? picked : (options[0]?.id ?? '');
  const { ref, check } = useNameCheck(ctx);

  async function submit(event: SyntheticEvent) {
    event.preventDefault();
    const clean = check(name);
    const chosen = options.find((ilha) => ilha.id === ilhaId);
    if (!clean || !chosen) {
      return;
    }
    const result = await ctx.perform(
      () => ctx.actions.registerAgent(clean, chosen.id),
      (user) => `Agente ${user.name} cadastrado na ilha ${chosen.name}.`,
    );
    if (result.ok) {
      ctx.select({ kind: 'user', id: result.value.id });
    }
  }

  return (
    <FormCard title="Cadastrar agente" onSubmit={(event) => void submit(event)}>
      <TextField label="Nome" value={name} onChange={setName} inputRef={ref} focusTarget />
      <SelectField
        label="Ilha"
        value={ilhaId}
        onChange={setPicked}
        disabled={options.length === 0}
        options={options.map((ilha) => ({ value: ilha.id, label: ilha.name }))}
      />
      {options.length === 0 ? <p className="admin-muted">Nenhuma ilha disponível para cadastrar agentes.</p> : null}
      <button type="submit" className="admin-primary" disabled={options.length === 0 || ctx.busy}>
        Cadastrar agente
      </button>
    </FormCard>
  );
}

export function NewIlhaForm({ ctx, supervisors }: { ctx: ConsoleContext; supervisors: readonly StaffUser[] }) {
  const [name, setName] = useState('');
  const active = byName(supervisors.filter((user) => user.active));
  const [picked, setPicked] = useState('');
  const supervisorId = active.some((user) => user.id === picked) ? picked : (active[0]?.id ?? '');
  const { ref, check } = useNameCheck(ctx);

  async function submit(event: SyntheticEvent) {
    event.preventDefault();
    const clean = check(name);
    const chosen = active.find((user) => user.id === supervisorId);
    if (!clean || !chosen) {
      return;
    }
    const result = await ctx.perform(
      () => ctx.actions.createIlha(clean, chosen.id),
      (ilha) => `Ilha ${ilha.name} criada.`,
    );
    if (result.ok) {
      ctx.select({ kind: 'ilha', id: result.value.id });
    }
  }

  return (
    <FormCard title="Criar ilha" onSubmit={(event) => void submit(event)}>
      <TextField label="Nome da ilha" value={name} onChange={setName} inputRef={ref} focusTarget />
      <SelectField
        label="Supervisor"
        value={supervisorId}
        onChange={setPicked}
        disabled={active.length === 0}
        options={active.map((user) => ({ value: user.id, label: user.name }))}
      />
      {active.length === 0 ? <p className="admin-muted">Cadastre um supervisor ativo antes de criar a ilha.</p> : null}
      <button type="submit" className="admin-primary" disabled={active.length === 0 || ctx.busy}>
        Criar ilha
      </button>
    </FormCard>
  );
}
