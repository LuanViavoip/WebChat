import {
  canAssignRole,
  effectiveGrants,
  canGrant,
  type AssignableRole,
  type Capability,
  type GrantDenial,
  type RoleDenial,
} from './capabilities';
import type { Conversation } from './conversation';
import type { Directory, StaffUser, UserId } from './identity';
import { own } from './records';
import { err, ok, type Result } from './result';
import type { TenantId } from './tenant';

/** Nesta etapa: diretas, envio, console e gestão de grants/roles. Grupos e avisos entram depois. */
export type Action =
  | { readonly type: 'direct.open'; readonly with: StaffUser }
  | { readonly type: 'conversation.send'; readonly conversation: Conversation }
  | { readonly type: 'admin.console' }
  | { readonly type: 'grant'; readonly target: StaffUser; readonly capability: Capability }
  | {
      readonly type: 'assignRole';
      readonly target: StaffUser | { readonly tenantId: TenantId };
      readonly role: AssignableRole;
    };

export type PermissionDenial =
  | GrantDenial
  | RoleDenial
  | 'unknown-actor'
  | 'no-chat-use'
  | 'no-capability'
  | 'same-user'
  | 'target-inactive'
  | 'target-no-chat-use'
  | 'not-participant';

/**
 * Ordem: tenant de toda entidade referenciada (ator, diretório, alvo, conversa e seus
 * participantes) → ator ativo → chat.use nas ações de chat → capacidade específica / pertença.
 * O estado (role, active, grants) vem SEMPRE do registro do diretório: o ator e o alvo
 * recebidos só dizem "quem", nunca "o que podem". Ator ausente do diretório: 'unknown-actor'.
 * O mock chama esta mesma função; a UI só esconde ou desabilita e mostra o motivo.
 */
export function can(claimedActor: StaffUser, action: Action, d: Directory): Result<true, PermissionDenial> {
  if (claimedActor.tenantId !== d.tenantId) {
    return err('cross-tenant');
  }
  const actor = own(d.users, claimedActor.id);
  if (!actor) {
    return err('unknown-actor');
  }
  if (actor.tenantId !== d.tenantId) {
    return err('cross-tenant');
  }
  const resolved = resolveAction(action, d);
  if (!resolved.ok) {
    return resolved;
  }
  if (!actor.active) {
    return err('actor-inactive');
  }
  const act = resolved.value;
  const held = effectiveGrants(actor);
  switch (act.type) {
    case 'direct.open': {
      if (!held.has('chat.use')) {
        return err('no-chat-use');
      }
      if (act.with.id === actor.id) {
        return err('same-user');
      }
      if (!act.with.active) {
        return err('target-inactive');
      }
      if (!effectiveGrants(act.with).has('chat.use')) {
        return err('target-no-chat-use');
      }
      return ok(true);
    }
    case 'conversation.send': {
      if (!held.has('chat.use')) {
        return err('no-chat-use');
      }
      return participantsOf(act.conversation).includes(actor.id) ? ok(true) : err('not-participant');
    }
    case 'admin.console':
      return held.has('admin.console') ? ok(true) : err('no-capability');
    case 'grant':
      return canGrant(actor, act.target, act.capability);
    case 'assignRole':
      return canAssignRole(actor, act.target, act.role);
  }
}

function participantsOf(conversation: Conversation): readonly UserId[] {
  return conversation.kind === 'direct' ? conversation.participants : conversation.members;
}

/**
 * Confere o tenant de tudo que a ação referencia e troca os alvos pelos registros do
 * diretório. Alvo ausente, forjado de outro tenant ou participante desconhecido: cross-tenant.
 */
function resolveAction(action: Action, d: Directory): Result<Action, 'cross-tenant'> {
  switch (action.type) {
    case 'direct.open': {
      const target = own(d.users, action.with.id);
      if (action.with.tenantId !== d.tenantId || !target || target.tenantId !== d.tenantId) {
        return err('cross-tenant');
      }
      return ok({ type: 'direct.open', with: target });
    }
    case 'conversation.send': {
      const { conversation } = action;
      const known = participantsOf(conversation).every((id) => {
        const member = own(d.users, id);
        return member !== undefined && member.tenantId === d.tenantId;
      });
      return conversation.tenantId === d.tenantId && known ? ok(action) : err('cross-tenant');
    }
    case 'admin.console':
      return ok(action);
    case 'grant': {
      const target = own(d.users, action.target.id);
      if (action.target.tenantId !== d.tenantId || !target || target.tenantId !== d.tenantId) {
        return err('cross-tenant');
      }
      return ok({ ...action, target });
    }
    case 'assignRole': {
      if (action.target.tenantId !== d.tenantId) {
        return err('cross-tenant');
      }
      if (!('id' in action.target)) {
        return ok(action);
      }
      const target = own(d.users, action.target.id);
      if (!target || target.tenantId !== d.tenantId) {
        return err('cross-tenant');
      }
      return ok({ ...action, target });
    }
  }
}
