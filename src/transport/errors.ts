/**
 * Operação negada. Id de outro tenant, id inexistente e falta de permissão viram o mesmo
 * erro, para nunca revelar se a entidade existe em outra empresa (§2.11).
 * `reason` só traz o motivo de negações DENTRO do tenant (ex.: 'no-chat-use'); fora disso é 'forbidden'.
 */
export class ForbiddenError extends Error {
  readonly reason: string;

  constructor(reason = 'forbidden') {
    super('Operação não permitida');
    this.name = 'ForbiddenError';
    this.reason = reason;
  }
}

export function isForbidden(error: unknown): error is ForbiddenError {
  return error instanceof ForbiddenError;
}
