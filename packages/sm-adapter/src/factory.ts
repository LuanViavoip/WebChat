import { MockSMAdapter } from './mock-sm-adapter.js';
import type { SMAdapter } from './types.js';

export class PendingSmContractError extends Error {
  constructor(adapterName: string) {
    super(`Contrato do SM pendente. O adaptador "${adapterName}" não está implementado.`);
    this.name = 'PendingSmContractError';
  }
}

export function createSMAdapter(name: string): SMAdapter {
  if (name === 'mock') return new MockSMAdapter();
  throw new PendingSmContractError(name);
}
