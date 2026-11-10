export class SessionAbortedError extends Error {
  constructor(message = 'Sessão de transporte encerrada') {
    super(message);
    this.name = 'SessionAbortedError';
  }
}

export function isSessionAborted(error: unknown): boolean {
  return error instanceof SessionAbortedError;
}
