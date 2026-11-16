import { validName } from '../../domain/directoryOps';

export function nameProblem(name: string): string | undefined {
  if (name.trim() === '') {
    return 'Informe o nome.';
  }
  return validName(name) === undefined ? 'Nome inválido: use até 80 caracteres, sem caracteres de controle.' : undefined;
}

export function byName<T extends { readonly name: string }>(items: readonly T[]): T[] {
  return items.slice().sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
}
