import {
  canForwardAnnouncementTo,
  isExpired,
  type Announcement,
  type AnnouncementForwardDenial,
} from './announcement';
import type { Audience } from './audience';
import {
  canAssignRole,
  canGrantIn,
  effectiveGrants,
  inManagementScope,
  type AssignableRole,
  type Capability,
  type GrantDenial,
  type RoleDenial,
} from './capabilities';
import type { Conversation, GroupConversation } from './conversation';
import type { IsoInstant } from './ids';
import type { Directory, StaffUser, UserId } from './identity';
import { own } from './records';
import { err, ok, type Result } from './result';
import type { TenantId } from './tenant';

/** Nesta etapa: diretas, envio, grupos, avisos, console e gestão de grants/roles. */
export type Action =
  | { readonly type: 'direct.open'; readonly with: StaffUser }
  | { readonly type: 'group.manage'; readonly group?: GroupConversation }
  | { readonly type: 'conversation.send'; readonly conversation: Conversation }
  | {
      readonly type: 'announcement.publish';
      readonly audience?: Audience;
      readonly groups?: readonly GroupConversation[];
    }
  | { readonly type: 'announcement.edit'; readonly announcement: Announcement }
  | { readonly type: 'announcement.read'; readonly announcement: Announcement; readonly now: IsoInstant }
  | { readonly type: 'announcement.receipts'; readonly announcement: Announcement }
  | { readonly type: 'announcement.remind'; readonly announcement: Announcement }
  | {
      readonly type: 'announcement.forward';
      readonly announcement: Announcement;
      readonly target: Conversation;
      readonly now: IsoInstant;
    }
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
  | AnnouncementForwardDenial
  | 'unknown-actor'
  | 'no-chat-use'
  | 'no-capability'
  | 'same-user'
  | 'target-inactive'
  | 'target-no-chat-use'
  | 'not-participant'
  | 'not-owner'
  | 'not-author'
  | 'not-in-audience';

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
    case 'group.manage':
      if (!held.has('group.manage')) return err('no-capability');
      if (!held.has('chat.use')) return err('no-chat-use');
      return !act.group ||
        actor.role === 'admin' ||
        (act.group.origin.kind === 'custom' && act.group.origin.createdBy === actor.id)
        ? ok(true)
        : err('not-owner');
    case 'announcement.publish':
      return canPublishAnnouncement(actor, act.audience, act.groups, held, d);
    case 'announcement.edit': {
      if (!held.has('announcement.publish')) {
        return err('no-capability');
      }
      return actor.role === 'admin' || act.announcement.authorId === actor.id
        ? ok(true)
        : err('not-author');
    }
    case 'announcement.read': {
      if (act.announcement.authorId === actor.id) {
        return ok(true);
      }
      if (!act.announcement.audienceUserIds.includes(actor.id)) {
        return err('not-in-audience');
      }
      return isExpired(act.announcement, act.now) ? err('expired') : ok(true);
    }
    case 'announcement.receipts':
    case 'announcement.remind': {
      if (!held.has('announcement.receipts')) {
        return err('no-capability');
      }
      return actor.role === 'admin' || act.announcement.authorId === actor.id
        ? ok(true)
        : err('not-author');
    }
    case 'announcement.forward': {
      if (!held.has('chat.use')) {
        return err('no-chat-use');
      }
      return canForwardAnnouncementTo(actor, act.announcement, act.target, act.now);
    }
    case 'admin.console':
      return held.has('admin.console') ? ok(true) : err('no-capability');
    case 'grant':
      return canGrantIn(d, actor.id, act.target.id, act.capability);
    case 'assignRole': {
      const verdict = canAssignRole(actor, act.target, act.role);
      if (!verdict.ok) {
        return verdict;
      }
      const existing = 'id' in act.target ? act.target : undefined;
      return actor.role === 'supervisor' && existing && !inManagementScope(d, actor, existing)
        ? err('outside-islands')
        : verdict;
    }
  }
}

function participantsOf(conversation: Conversation): readonly UserId[] {
  return conversation.kind === 'direct' ? conversation.participants : conversation.members;
}

function canPublishAnnouncement(
  actor: StaffUser,
  audience: Audience | undefined,
  groups: readonly GroupConversation[] | undefined,
  held: ReadonlySet<Capability>,
  d: Directory,
): Result<true, PermissionDenial> {
  if (!held.has('announcement.publish')) {
    return err('no-capability');
  }
  if (!audience) {
    return ok(true);
  }
  switch (audience.kind) {
    case 'all':
      return ok(true);
    case 'ilhas': {
      if (actor.role === 'admin') {
        return ok(true);
      }
      const allowed = audience.ilhaIds.every((ilhaId) => own(d.ilhas, ilhaId)?.supervisorIds.includes(actor.id));
      return allowed ? ok(true) : err('outside-islands');
    }
    case 'groups': {
      const byId = new Map((groups ?? []).map((group) => [group.id, group]));
      const allowed = audience.groupIds.every((groupId) => byId.get(groupId)?.members.includes(actor.id));
      return allowed ? ok(true) : err('not-participant');
    }
    case 'people': {
      for (const userId of audience.userIds) {
        const target = own(d.users, userId);
        if (!target) {
          return err('cross-tenant');
        }
        if (!target.active) {
          return err('target-inactive');
        }
        if (!effectiveGrants(target).has('chat.use')) {
          return err('target-no-chat-use');
        }
      }
      return ok(true);
    }
  }
}

function resolvePublishAudience(
  action: Extract<Action, { type: 'announcement.publish' }>,
  d: Directory,
): Result<Action, 'cross-tenant'> {
  const audience = action.audience;
  if (!audience) {
    return ok(action);
  }
  switch (audience.kind) {
    case 'all':
      return ok(action);
    case 'ilhas': {
      const ilhasValid = audience.ilhaIds.every((id) => own(d.ilhas, id)?.tenantId === d.tenantId);
      return ilhasValid ? ok(action) : err('cross-tenant');
    }
    case 'groups': {
      if (!action.groups) {
        return err('cross-tenant');
      }
      const byId = new Map(action.groups.map((group) => [group.id, group]));
      const groupsValid = audience.groupIds.every((groupId) => {
        const group = byId.get(groupId);
        return group !== undefined && conversationBelongsToTenant(group, d);
      });
      return groupsValid ? ok(action) : err('cross-tenant');
    }
    case 'people': {
      const usersValid = audience.userIds.every((id) => own(d.users, id)?.tenantId === d.tenantId);
      return usersValid ? ok(action) : err('cross-tenant');
    }
  }
}

function conversationBelongsToTenant(conversation: Conversation, d: Directory): boolean {
  return (
    conversation.tenantId === d.tenantId &&
    participantsOf(conversation).every((id) => own(d.users, id)?.tenantId === d.tenantId)
  );
}

function announcementBelongsToTenant(announcement: Announcement, d: Directory): boolean {
  return (
    announcement.tenantId === d.tenantId &&
    own(d.users, announcement.authorId)?.tenantId === d.tenantId &&
    announcement.audienceUserIds.every((id) => own(d.users, id)?.tenantId === d.tenantId)
  );
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
      return conversationBelongsToTenant(action.conversation, d) ? ok(action) : err('cross-tenant');
    }
    case 'group.manage': {
      const group = action.group;
      if (!group) return ok(action);
      const originValid =
        group.origin.kind === 'custom'
          ? own(d.users, group.origin.createdBy)?.tenantId === d.tenantId
          : own(d.ilhas, group.origin.ilhaId)?.tenantId === d.tenantId;
      const membersValid = group.members.every((id) => own(d.users, id)?.tenantId === d.tenantId);
      return group.tenantId === d.tenantId && originValid && membersValid ? ok(action) : err('cross-tenant');
    }
    case 'announcement.publish':
      return resolvePublishAudience(action, d);
    case 'announcement.edit':
    case 'announcement.read':
    case 'announcement.receipts':
    case 'announcement.remind':
      return announcementBelongsToTenant(action.announcement, d) ? ok(action) : err('cross-tenant');
    case 'announcement.forward':
      return announcementBelongsToTenant(action.announcement, d) && conversationBelongsToTenant(action.target, d)
        ? ok(action)
        : err('cross-tenant');
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
