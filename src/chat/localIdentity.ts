import type { UserId } from '../domain/identity';
import type { TenantId } from '../domain/tenant';

/**
 * Identidade fixa do transporte atual, de uma conversa só. Vale até o bloco 2/3 da
 * Etapa 4, quando a sessão passa a vir do Bootstrap (connect({ tenantId, userId })).
 */
export const LOCAL_TENANT_ID = 'empresa-local' as TenantId;
export const LOCAL_USER_ID = 'usuario-local' as UserId;
export const PEER_USER_ID = 'colega-local' as UserId;
