import type { ErrorCode } from '@viavoip/protocol';

export class DomainError extends Error {
  readonly code: ErrorCode;

  constructor(code: ErrorCode, message: string) {
    super(message);
    this.name = 'DomainError';
    this.code = code;
  }
}

export function httpStatus(code: ErrorCode): number {
  switch (code) {
    case 'unauthorized':
      return 401;
    case 'forbidden':
      return 403;
    case 'not_found':
      return 404;
    case 'invalid_payload':
      return 400;
    case 'invalid_state':
    case 'already_claimed':
    case 'capacity':
    case 'conflict':
      return 409;
    case 'rate_limited':
      return 429;
    case 'internal':
      return 500;
    default: {
      const neverCode: never = code;
      return neverCode;
    }
  }
}
