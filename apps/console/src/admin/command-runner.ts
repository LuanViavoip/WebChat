import type { CompanyCommand, CompanyCommandResult } from '@viavoip/protocol';
import { isRetryable } from './company-desk.js';

export type CommandSubmit = (command: CompanyCommand, requestId: string) => Promise<CompanyCommandResult>;

/**
 * Guarda o requestId da tentativa lógica de um comando.
 *
 * - O id nasce na primeira submissão e é reaproveitado se o usuário reenviar o MESMO conteúdo
 *   depois de uma falha retryável (rede, timeout): o servidor trata como repetição, sem duplicar efeito.
 * - Muda quando o conteúdo do comando muda, depois de sucesso ou de erro definitivo (recusa do servidor).
 * - Enquanto houver um envio pendente, novas submissões são ignoradas.
 */
export class CommandRunner {
  private requestId: string | null = null;
  private fingerprint: string | null = null;
  private inFlight = false;

  get pending(): boolean {
    return this.inFlight;
  }

  /** Id que seria usado agora para este comando (útil para testes e diagnóstico). */
  peek(): string | null {
    return this.requestId;
  }

  /**
   * Devolve o resultado, ou `null` quando já havia envio pendente.
   * Lança o erro do envio; o chamador decide como mostrá-lo.
   */
  async run(command: CompanyCommand, submit: CommandSubmit): Promise<CompanyCommandResult | null> {
    if (this.inFlight) return null;
    const fingerprint = JSON.stringify(command);
    if (this.fingerprint !== fingerprint || !this.requestId) {
      this.fingerprint = fingerprint;
      this.requestId = crypto.randomUUID();
    }
    const requestId = this.requestId;
    this.inFlight = true;
    try {
      const result = await submit(command, requestId);
      this.reset();
      return result;
    } catch (error) {
      if (!isRetryable(error)) this.reset();
      throw error;
    } finally {
      this.inFlight = false;
    }
  }

  /** Descarta a tentativa (por exemplo, quando o formulário é fechado). */
  reset(): void {
    this.requestId = null;
    this.fingerprint = null;
  }
}
