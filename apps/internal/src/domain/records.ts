/** Busca por chave própria: ids como '__proto__' ou 'constructor' nunca acham herança do Object. */
export function own<K extends string, V>(record: Readonly<Record<K, V>>, key: K): V | undefined {
  return Object.hasOwn(record, key) ? record[key] : undefined;
}

export function hasOwnKey<K extends string>(record: Readonly<Record<K, unknown>>, key: K): boolean {
  return Object.hasOwn(record, key);
}
