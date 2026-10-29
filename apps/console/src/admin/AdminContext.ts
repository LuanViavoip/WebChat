import { companyCommandSchema, type CompanyCommand, type CompanyCommandResult, type CompanyDesk } from '@viavoip/protocol';
import { useCallback, useRef, useState } from 'react';
import { useCompanyCommand } from './useCompanyCommand.js';

export type AdminContext = {
  token: string;
  desk: CompanyDesk;
  applyResult: (result: CompanyCommandResult) => void;
  announce: (message: string, result: CompanyCommandResult) => void;
};

/** Primeira mensagem útil de uma validação do schema, no formato "campo: motivo". */
export function describeInvalid(error: { issues: { path: PropertyKey[]; message: string }[] }): string {
  const issue = error.issues[0];
  if (!issue) return 'Confira os dados informados.';
  // Mensagens próprias do protocolo começam em minúscula ("origem repetida"); as padrão do zod, em maiúscula.
  if (/^\p{Ll}/u.test(issue.message)) return `Confira os dados informados: ${issue.message}.`;
  const path = issue.path.map(String).join('.');
  return path ? `Confira os dados informados (${path}).` : 'Confira os dados informados.';
}

/**
 * Comando da empresa para um formulário ou botão: valida com o schema do protocolo antes de enviar,
 * reaproveita o requestId em reenvios após falha retryável e expõe `pending`/`error` próprios.
 */
export function useAdminCommand(ctx: AdminContext) {
  const { token, applyResult, announce } = ctx;
  const failure = useRef('');
  const command = useCompanyCommand({
    token,
    onResult: applyResult,
    onError: (message) => {
      failure.current = message;
    },
  });
  const [invalid, setInvalid] = useState('');
  const run = command.run;

  const submit = useCallback(
    async (candidate: CompanyCommand, success: string): Promise<boolean> => {
      const parsed = companyCommandSchema.safeParse(candidate);
      failure.current = '';
      if (!parsed.success) {
        failure.current = describeInvalid(parsed.error);
        setInvalid(failure.current);
        return false;
      }
      setInvalid('');
      const result = await run(parsed.data);
      if (!result) return false;
      announce(success, result);
      return true;
    },
    [announce, run],
  );

  const reset = command.reset;
  return {
    submit,
    pending: command.pending,
    error: invalid || command.error,
    /** Mensagem da última falha, legível logo após `submit` resolver (o estado `error` ainda não renderizou). */
    lastError: () => failure.current,
    reset: useCallback(() => {
      setInvalid('');
      reset();
    }, [reset]),
  };
}
