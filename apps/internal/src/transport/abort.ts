export class SessionAbortedError extends Error {
  constructor(message = 'Sessão de transporte encerrada') {
    super(message);
    this.name = 'SessionAbortedError';
  }
}

export class UploadCanceledError extends Error {
  constructor(message = 'Upload cancelado') {
    super(message);
    this.name = 'UploadCanceledError';
  }
}

export class UploadFailedError extends Error {
  constructor(message = 'Falha no upload') {
    super(message);
    this.name = 'UploadFailedError';
  }
}

export function isSessionAborted(error: unknown): boolean {
  return error instanceof SessionAbortedError;
}

export function isUploadCanceled(error: unknown): boolean {
  return error instanceof UploadCanceledError;
}
