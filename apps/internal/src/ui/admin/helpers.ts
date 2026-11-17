import { own, validName, type Directory, type IlhaId } from '@viavoip/internal-domain';

/** "Ilha Norte" (uma) ou "Ilhas Norte, Exames" (várias; N:N). Vazio se nenhuma existe no diretório. */
export function ilhaLabel(directory: Directory, ilhaIds: readonly IlhaId[]): string | undefined {
  const names = ilhaIds.map((id) => own(directory.ilhas, id)?.name).filter((name) => name !== undefined);
  if (names.length === 0) return undefined;
  return `${names.length > 1 ? 'Ilhas' : 'Ilha'} ${names.join(', ')}`;
}

export function nameProblem(name: string): string | undefined {
  if (name.trim() === '') {
    return 'Informe o nome.';
  }
  return validName(name) === undefined ? 'Nome inválido: use até 80 caracteres, sem caracteres de controle.' : undefined;
}

export function byName<T extends { readonly name: string }>(items: readonly T[]): T[] {
  return items.slice().sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
}
