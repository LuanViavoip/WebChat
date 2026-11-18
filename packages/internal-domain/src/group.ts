import { effectiveGrants } from './capabilities';
import type { ConversationId, GroupConversation, GroupOrigin } from './conversation';
import type { Directory, StaffUser, UserId } from './identity';
import { own } from './records';
import { err, ok, type Result } from './result';

export type GroupError = 'empty-title' | 'empty-members' | 'creator-not-member' | 'duplicate-member' | 'too-many-members' | 'cross-tenant' | 'unknown-ilha' | 'members-managed-by-ilha';
export type CreateGroupInput = {
  readonly id: ConversationId;
  readonly title: string;
  readonly creator: StaffUser;
  readonly members: readonly StaffUser[];
  readonly directory: Directory;
  readonly origin: GroupOrigin;
  readonly createdAt: string;
};

export function createGroup(input: CreateGroupInput): Result<GroupConversation, GroupError> {
  const { creator, directory, members, origin } = input;
  if (directory.tenantId !== creator.tenantId || members.some((member) => member.tenantId !== creator.tenantId)) return err('cross-tenant');
  if (origin.kind === 'ilha') {
    const ilha = own(directory.ilhas, origin.ilhaId);
    if (!ilha) return err('unknown-ilha');
    if (ilha.tenantId !== creator.tenantId) return err('cross-tenant');
  }
  const validated = validate(input.title, members);
  if (!validated.ok) return validated;
  if (origin.kind === 'custom' && (origin.createdBy !== creator.id || !validated.value.members.includes(creator.id))) return err('creator-not-member');
  return ok({ kind: 'group', id: input.id, tenantId: creator.tenantId, title: validated.value.title, origin, members: validated.value.members, formerMemberIds: [], createdAt: input.createdAt });
}

function validate(title: string, members: readonly StaffUser[]): Result<{ title: string; members: readonly [UserId, ...UserId[]] }, GroupError> {
  const cleanTitle = title.trim();
  if (!cleanTitle) return err('empty-title');
  const [first, ...rest] = members;
  if (!first) return err('empty-members');
  if (members.length > 256) return err('too-many-members');
  const ids = members.map((member) => member.id);
  if (new Set(ids).size !== ids.length) return err('duplicate-member');
  return ok({ title: cleanTitle, members: [first.id, ...rest.map((member) => member.id)] });
}

export function updateGroup(group: GroupConversation, change: { readonly title?: string; readonly add?: readonly StaffUser[]; readonly remove?: readonly UserId[] }, directory: Directory): Result<GroupConversation, GroupError> {
  if (directory.tenantId !== group.tenantId || change.add?.some((member) => member.tenantId !== group.tenantId)) return err('cross-tenant');
  if (group.origin.kind === 'ilha' && ((change.add?.length ?? 0) > 0 || (change.remove?.length ?? 0) > 0)) return err('members-managed-by-ilha');
  const remove = new Set(change.remove ?? []);
  const members: StaffUser[] = [];
  for (const id of group.members) {
    if (remove.has(id)) continue;
    const member = own(directory.users, id);
    if (!member || member.tenantId !== group.tenantId) return err('cross-tenant');
    members.push(member);
  }
  for (const member of change.add ?? []) {
    const actual = own(directory.users, member.id);
    if (!actual || actual.tenantId !== group.tenantId) return err('cross-tenant');
    members.push(actual);
  }
  const validated = validate(change.title ?? group.title, members);
  if (!validated.ok) return validated;
  const hasManager = members.some((member) => member.active && (group.origin.kind === 'custom' && member.id === group.origin.createdBy || member.role === 'admin') && effectiveGrants(member).has('group.manage') && effectiveGrants(member).has('chat.use'));
  if (group.origin.kind === 'custom' && !hasManager) return err('creator-not-member');
  const active = new Set(validated.value.members);
  const formerMemberIds = [...new Set([...group.formerMemberIds, ...group.members.filter((id) => !active.has(id))])].filter((id) => !active.has(id));
  return ok({ ...group, title: validated.value.title, members: validated.value.members, formerMemberIds });
}

