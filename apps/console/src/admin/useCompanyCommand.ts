import type { CompanyCommand, CompanyCommandResult } from '@viavoip/protocol';
import { useCallback, useEffect, useRef, useState } from 'react';
import { CommandRunner } from './command-runner.js';
import { submitCompanyCommand } from './company-desk.js';

type Options = {
  token: string;
  /** Chamado com o resultado de cada comando aplicado (inclui o desk atualizado). */
  onResult?: (result: CompanyCommandResult) => void;
  /** Chamado de forma síncrona quando o envio falha, com a mensagem mostrável. */
  onError?: (message: string) => void;
};

/**
 * Envia comandos da empresa com idempotência: a mesma tentativa lógica reaproveita o requestId
 * (ver `CommandRunner`). `pending` desabilita o botão de envio; `error` guarda a última recusa.
 */
export function useCompanyCommand({ token, onResult, onError }: Options) {
  const runner = useRef(new CommandRunner());
  const mounted = useRef(true);
  const onResultRef = useRef(onResult);
  onResultRef.current = onResult;
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const run = useCallback(
    async (command: CompanyCommand): Promise<CompanyCommandResult | null> => {
      if (runner.current.pending) return null;
      setPending(true);
      setError('');
      try {
        const result = await runner.current.run(command, (next, requestId) =>
          submitCompanyCommand({ token }, next, { requestId }),
        );
        if (result) onResultRef.current?.(result);
        return result;
      } catch (reason: unknown) {
        const message = reason instanceof Error ? reason.message : 'Falha na gestão da empresa';
        onErrorRef.current?.(message);
        if (mounted.current) setError(message);
        return null;
      } finally {
        if (mounted.current) setPending(false);
      }
    },
    [token],
  );

  /** Fecha uma tentativa em aberto (ex.: ao fechar o modal) e limpa o erro. */
  const reset = useCallback(() => {
    runner.current.reset();
    setError('');
  }, []);

  return { run, pending, error, reset };
}
