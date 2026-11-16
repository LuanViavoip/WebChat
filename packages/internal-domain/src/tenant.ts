declare const brand: unique symbol;
export type Brand<T, B extends string> = T & { readonly [brand]: B };

export type TenantId = Brand<string, 'TenantId'>;
/** 'YYYY-MM-DD' no fuso da empresa. */
export type LocalDate = Brand<string, 'LocalDate'>;

export type Tenant = {
  readonly id: TenantId;
  readonly name: string;
  /** IANA, ex. 'America/Sao_Paulo'. Define o "dia" da empresa. */
  readonly timeZone: string;
};
