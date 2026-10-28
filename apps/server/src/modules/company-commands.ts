import type { CompanyCommand } from '@viavoip/protocol';
import type { PoolClient } from 'pg';
import { hashPassword } from '../auth/passwords.js';
import { isUniqueViolation } from '../db/pg-error.js';
import { DomainError } from '../domain/errors.js';
import type { AgentPrincipal } from '../domain/types.js';
import { writeAudit } from './audit.js';

export async function executeCompanyCommand(
  client: PoolClient,
  principal: AgentPrincipal,
  command: CompanyCommand,
  revokedSessionIds: string[],
): Promise<void> {
  switch (command.kind) {
    case 'company.rename':
      await client.query(`UPDATE tenants SET name = $2 WHERE id = $1`, [principal.tenantId, command.name]);
      await writeAudit(client, principal.tenantId, principal.agentId, command.kind, 'tenant', principal.tenantId);
      return;
    case 'company.concurrency_limit':
      await client.query(`UPDATE tenants SET max_concurrent_assignments = $2 WHERE id = $1`, [
        principal.tenantId,
        command.max,
      ]);
      await writeAudit(client, principal.tenantId, principal.agentId, command.kind, 'tenant', principal.tenantId);
      return;
    case 'company.time_zone':
      await client.query(`UPDATE tenants SET time_zone = $2 WHERE id = $1`, [principal.tenantId, command.timeZone]);
      await writeAudit(client, principal.tenantId, principal.agentId, command.kind, 'tenant', principal.tenantId);
      return;
    case 'site.create':
      await createSite(client, principal, command);
      return;
    case 'site.appearance_replace':
      await replaceAppearance(client, principal, command);
      return;
    case 'site.acceptance_set':
      await setAcceptance(client, principal, command);
      return;
    case 'site.origins_replace':
      await replaceOrigins(client, principal, command);
      return;
    case 'site.service_windows_replace':
      await replaceWindows(client, principal, command);
      return;
    case 'queue.create':
      await createQueue(client, principal, command.name);
      return;
    case 'queue.rename':
      await renameQueue(client, principal, command.queueId, command.name);
      return;
    case 'disposition.create':
      await createDisposition(client, principal, command.name);
      return;
    case 'disposition.rename':
      await renameDisposition(client, principal, command.dispositionId, command.name);
      return;
    case 'disposition.retire':
      await retireDisposition(client, principal, command.dispositionId);
      return;
    case 'survey.publish':
      await publishSurvey(client, principal, command);
      return;
    case 'agent.create':
      await createAgent(client, principal, command);
      return;
    case 'agent.suspend':
      await suspendAgent(client, principal, command.agentId, command.reason, revokedSessionIds);
      return;
    case 'agent.reactivate':
      await reactivateAgent(client, principal, command.agentId);
      return;
    case 'agent.role_change':
      await changeRole(client, principal, command, revokedSessionIds);
      return;
    case 'agent.queues_replace':
      await replaceQueues(client, principal, command.agentId, command.queueIds, revokedSessionIds);
      return;
    case 'agent.activity_authority':
      await setActivityAuthority(client, principal, command, revokedSessionIds);
      return;
    case 'agent.credential_reset':
      await resetCredential(client, principal, command.agentId, command.password, revokedSessionIds);
      return;
    case 'agent.sessions_revoke':
      await revokeAgentSessions(client, principal, command.agentId, revokedSessionIds);
      return;
    case 'sla.publish':
    case 'sla.retire':
      throw new Error('not implemented');
    default: {
      const unexpected: never = command;
      throw new Error(`not implemented: ${String(unexpected)}`);
    }
  }
}

async function createSite(
  client: PoolClient,
  principal: AgentPrincipal,
  command: Extract<CompanyCommand, { kind: 'site.create' }>,
): Promise<void> {
  try {
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO sites (tenant_id, public_id, name, allowed_origins, acceptance, pause_reason)
       VALUES ($1, $2, $3, '{}', 'paused', 'Aguardando origens permitidas')
       RETURNING id`,
      [principal.tenantId, command.publicId, command.name],
    );
    const siteId = inserted.rows[0]?.id;
    if (!siteId) throw new DomainError('internal', 'Site não criado');
    await writeAudit(client, principal.tenantId, principal.agentId, command.kind, 'site', siteId);
  } catch (error) {
    if (isUniqueViolation(error)) throw new DomainError('conflict', 'Identificador público indisponível');
    throw error;
  }
}

async function replaceAppearance(
  client: PoolClient,
  principal: AgentPrincipal,
  command: Extract<CompanyCommand, { kind: 'site.appearance_replace' }>,
): Promise<void> {
  const updated = await client.query(
    `UPDATE sites
     SET name = $3,
         primary_color = $4,
         logo_url = $5,
         welcome_message = $6,
         require_visitor_name = $7
     WHERE id = $1 AND tenant_id = $2`,
    [
      command.siteId,
      principal.tenantId,
      command.name,
      command.appearance.primaryColor,
      command.appearance.logo.kind === 'https' ? command.appearance.logo.url : null,
      command.appearance.welcomeMessage,
      command.appearance.identity.kind === 'name_required',
    ],
  );
  if (updated.rowCount !== 1) throw new DomainError('not_found', 'Site não encontrado');
  await writeAudit(client, principal.tenantId, principal.agentId, command.kind, 'site', command.siteId);
}

async function setAcceptance(
  client: PoolClient,
  principal: AgentPrincipal,
  command: Extract<CompanyCommand, { kind: 'site.acceptance_set' }>,
): Promise<void> {
  if (command.acceptance.kind === 'accepting') {
    const site = await client.query<{ allowed_origins: string[] }>(
      `SELECT allowed_origins FROM sites WHERE id = $1 AND tenant_id = $2`,
      [command.siteId, principal.tenantId],
    );
    const origins = site.rows[0]?.allowed_origins;
    if (!origins) throw new DomainError('not_found', 'Site não encontrado');
    if (origins.length < 1) throw new DomainError('invalid_state', 'Site sem origens permitidas');
  }
  const updated = await client.query(
    `UPDATE sites
     SET acceptance = $3, pause_reason = $4
     WHERE id = $1 AND tenant_id = $2`,
    [
      command.siteId,
      principal.tenantId,
      command.acceptance.kind === 'paused' ? 'paused' : 'accepting',
      command.acceptance.kind === 'paused' ? command.acceptance.reason : null,
    ],
  );
  if (updated.rowCount !== 1) throw new DomainError('not_found', 'Site não encontrado');
  await writeAudit(client, principal.tenantId, principal.agentId, command.kind, 'site', command.siteId);
}

async function replaceOrigins(
  client: PoolClient,
  principal: AgentPrincipal,
  command: Extract<CompanyCommand, { kind: 'site.origins_replace' }>,
): Promise<void> {
  const site = await client.query<{ acceptance: string }>(
    `SELECT acceptance FROM sites WHERE id = $1 AND tenant_id = $2`,
    [command.siteId, principal.tenantId],
  );
  const acceptance = site.rows[0]?.acceptance;
  if (!acceptance) throw new DomainError('not_found', 'Site não encontrado');
  if (acceptance === 'accepting' && command.allowedOrigins.length < 1) {
    throw new DomainError('invalid_state', 'Site sem origens permitidas');
  }
  await client.query(`UPDATE sites SET allowed_origins = $3 WHERE id = $1 AND tenant_id = $2`, [
    command.siteId,
    principal.tenantId,
    command.allowedOrigins,
  ]);
  await writeAudit(client, principal.tenantId, principal.agentId, command.kind, 'site', command.siteId);
}

async function replaceWindows(
  client: PoolClient,
  principal: AgentPrincipal,
  command: Extract<CompanyCommand, { kind: 'site.service_windows_replace' }>,
): Promise<void> {
  const site = await client.query(`SELECT id FROM sites WHERE id = $1 AND tenant_id = $2`, [
    command.siteId,
    principal.tenantId,
  ]);
  if (!site.rows[0]) throw new DomainError('not_found', 'Site não encontrado');
  await client.query(`DELETE FROM site_service_windows WHERE site_id = $1 AND tenant_id = $2`, [
    command.siteId,
    principal.tenantId,
  ]);
  if (command.calendar.kind === 'weekly') {
    for (const window of command.calendar.windows) {
      await client.query(
        `INSERT INTO site_service_windows (site_id, tenant_id, weekday, start_minute, end_minute)
         VALUES ($1, $2, $3, $4, $5)`,
        [command.siteId, principal.tenantId, window.weekday, window.startMinute, window.endMinute],
      );
    }
  }
  await writeAudit(client, principal.tenantId, principal.agentId, command.kind, 'site', command.siteId);
}

async function createQueue(client: PoolClient, principal: AgentPrincipal, name: string): Promise<void> {
  try {
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO queues (tenant_id, name) VALUES ($1, $2) RETURNING id`,
      [principal.tenantId, name],
    );
    const queueId = inserted.rows[0]?.id;
    if (!queueId) throw new DomainError('internal', 'Fila não criada');
    await writeAudit(client, principal.tenantId, principal.agentId, 'queue.create', 'queue', queueId);
  } catch (error) {
    if (isUniqueViolation(error)) throw new DomainError('conflict', 'Nome já usado nesta empresa');
    throw error;
  }
}

async function renameQueue(
  client: PoolClient,
  principal: AgentPrincipal,
  queueId: string,
  name: string,
): Promise<void> {
  try {
    const updated = await client.query(`UPDATE queues SET name = $3 WHERE id = $1 AND tenant_id = $2`, [
      queueId,
      principal.tenantId,
      name,
    ]);
    if (updated.rowCount !== 1) throw new DomainError('not_found', 'Fila não encontrada');
    await writeAudit(client, principal.tenantId, principal.agentId, 'queue.rename', 'queue', queueId);
  } catch (error) {
    if (isUniqueViolation(error)) throw new DomainError('conflict', 'Nome já usado nesta empresa');
    throw error;
  }
}

async function createDisposition(client: PoolClient, principal: AgentPrincipal, name: string): Promise<void> {
  try {
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO dispositions (tenant_id, name) VALUES ($1, $2) RETURNING id`,
      [principal.tenantId, name],
    );
    const dispositionId = inserted.rows[0]?.id;
    if (!dispositionId) throw new DomainError('internal', 'Classificação não criada');
    await writeAudit(client, principal.tenantId, principal.agentId, 'disposition.create', 'disposition', dispositionId);
  } catch (error) {
    if (isUniqueViolation(error)) throw new DomainError('conflict', 'Nome já usado nesta empresa');
    throw error;
  }
}

async function renameDisposition(
  client: PoolClient,
  principal: AgentPrincipal,
  dispositionId: string,
  name: string,
): Promise<void> {
  try {
    const updated = await client.query(`UPDATE dispositions SET name = $3 WHERE id = $1 AND tenant_id = $2`, [
      dispositionId,
      principal.tenantId,
      name,
    ]);
    if (updated.rowCount !== 1) throw new DomainError('not_found', 'Classificação não encontrada');
    await writeAudit(client, principal.tenantId, principal.agentId, 'disposition.rename', 'disposition', dispositionId);
  } catch (error) {
    if (isUniqueViolation(error)) throw new DomainError('conflict', 'Nome já usado nesta empresa');
    throw error;
  }
}

async function retireDisposition(
  client: PoolClient,
  principal: AgentPrincipal,
  dispositionId: string,
): Promise<void> {
  const updated = await client.query(
    `UPDATE dispositions
     SET status = 'retired', retired_at = now()
     WHERE id = $1 AND tenant_id = $2 AND status = 'active'`,
    [dispositionId, principal.tenantId],
  );
  if (updated.rowCount !== 1) throw new DomainError('not_found', 'Classificação não encontrada');
  await writeAudit(client, principal.tenantId, principal.agentId, 'disposition.retire', 'disposition', dispositionId);
}

async function createAgent(
  client: PoolClient,
  principal: AgentPrincipal,
  command: Extract<CompanyCommand, { kind: 'agent.create' }>,
): Promise<void> {
  const passwordHash = await hashPassword(command.password);
  const role = command.placement.role;
  const selfService = command.placement.role === 'agent' && command.placement.activityAuthority.kind === 'self_service';
  try {
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO agents (
         tenant_id, email, name, password_hash, role, can_change_own_activity, membership_status
       ) VALUES ($1, $2, $3, $4, $5, $6, 'active')
       RETURNING id`,
      [principal.tenantId, command.email, command.name, passwordHash, role, selfService],
    );
    const agentId = inserted.rows[0]?.id;
    if (!agentId) throw new DomainError('internal', 'Pessoa não criada');
    if (command.placement.role === 'agent') {
      for (const queueId of command.placement.queueIds) {
        const queue = await client.query(`SELECT id FROM queues WHERE id = $1 AND tenant_id = $2`, [
          queueId,
          principal.tenantId,
        ]);
        if (!queue.rows[0]) throw new DomainError('not_found', 'Fila não encontrada');
        await client.query(
          `INSERT INTO agent_queues (agent_id, queue_id, tenant_id) VALUES ($1, $2, $3)`,
          [agentId, queueId, principal.tenantId],
        );
      }
    }
    await writeAudit(client, principal.tenantId, principal.agentId, command.kind, 'agent', agentId);
  } catch (error) {
    if (isUniqueViolation(error)) throw new DomainError('conflict', 'E-mail indisponível');
    throw error;
  }
}

async function suspendAgent(
  client: PoolClient,
  principal: AgentPrincipal,
  agentId: string,
  reason: string,
  revokedSessionIds: string[],
): Promise<void> {
  if (agentId === principal.agentId) throw new DomainError('invalid_state', 'O administrador não suspende a própria conta');
  await assertNotLastAdmin(client, principal.tenantId, agentId);
  const updated = await client.query(
    `UPDATE agents
     SET membership_status = 'suspended', suspended_at = now(), suspension_reason = $3
     WHERE id = $1 AND tenant_id = $2 AND membership_status = 'active'`,
    [agentId, principal.tenantId, reason],
  );
  if (updated.rowCount !== 1) throw new DomainError('not_found', 'Pessoa não encontrada');
  await revokeAccess(client, principal.tenantId, agentId, revokedSessionIds);
  await writeAudit(client, principal.tenantId, principal.agentId, 'agent.suspend', 'agent', agentId);
}

async function reactivateAgent(client: PoolClient, principal: AgentPrincipal, agentId: string): Promise<void> {
  const updated = await client.query(
    `UPDATE agents
     SET membership_status = 'active', suspended_at = NULL, suspension_reason = NULL
     WHERE id = $1 AND tenant_id = $2 AND membership_status = 'suspended'`,
    [agentId, principal.tenantId],
  );
  if (updated.rowCount !== 1) throw new DomainError('not_found', 'Pessoa não encontrada');
  await writeAudit(client, principal.tenantId, principal.agentId, 'agent.reactivate', 'agent', agentId);
}

async function changeRole(
  client: PoolClient,
  principal: AgentPrincipal,
  command: Extract<CompanyCommand, { kind: 'agent.role_change' }>,
  revokedSessionIds: string[],
): Promise<void> {
  if (command.placement.role !== 'admin') await assertNotLastAdmin(client, principal.tenantId, command.agentId);
  const selfService = command.placement.role === 'agent' && command.placement.activityAuthority.kind === 'self_service';
  const updated = await client.query(
    `UPDATE agents SET role = $3, can_change_own_activity = $4 WHERE id = $1 AND tenant_id = $2`,
    [command.agentId, principal.tenantId, command.placement.role, selfService],
  );
  if (updated.rowCount !== 1) throw new DomainError('not_found', 'Pessoa não encontrada');
  await client.query(`DELETE FROM agent_queues WHERE agent_id = $1 AND tenant_id = $2`, [
    command.agentId,
    principal.tenantId,
  ]);
  if (command.placement.role === 'agent') {
    for (const queueId of command.placement.queueIds) {
      await client.query(`INSERT INTO agent_queues (agent_id, queue_id, tenant_id) VALUES ($1, $2, $3)`, [
        command.agentId,
        queueId,
        principal.tenantId,
      ]);
    }
  }
  await revokeAccess(client, principal.tenantId, command.agentId, revokedSessionIds);
  await writeAudit(client, principal.tenantId, principal.agentId, command.kind, 'agent', command.agentId);
}

async function replaceQueues(
  client: PoolClient,
  principal: AgentPrincipal,
  agentId: string,
  queueIds: string[],
  revokedSessionIds: string[],
): Promise<void> {
  const agent = await client.query<{ role: string }>(
    `SELECT role FROM agents WHERE id = $1 AND tenant_id = $2`,
    [agentId, principal.tenantId],
  );
  if (agent.rows[0]?.role !== 'agent') throw new DomainError('invalid_state', 'Filas são exclusivas do agente');
  await client.query(`DELETE FROM agent_queues WHERE agent_id = $1 AND tenant_id = $2`, [agentId, principal.tenantId]);
  for (const queueId of queueIds) {
    const queue = await client.query(`SELECT id FROM queues WHERE id = $1 AND tenant_id = $2`, [queueId, principal.tenantId]);
    if (!queue.rows[0]) throw new DomainError('not_found', 'Fila não encontrada');
    await client.query(`INSERT INTO agent_queues (agent_id, queue_id, tenant_id) VALUES ($1, $2, $3)`, [
      agentId,
      queueId,
      principal.tenantId,
    ]);
  }
  await revokeAccess(client, principal.tenantId, agentId, revokedSessionIds);
  await writeAudit(client, principal.tenantId, principal.agentId, 'agent.queues_replace', 'agent', agentId);
}

async function setActivityAuthority(
  client: PoolClient,
  principal: AgentPrincipal,
  command: Extract<CompanyCommand, { kind: 'agent.activity_authority' }>,
  revokedSessionIds: string[],
): Promise<void> {
  const updated = await client.query(
    `UPDATE agents SET can_change_own_activity = $3
     WHERE id = $1 AND tenant_id = $2 AND role = 'agent'`,
    [command.agentId, principal.tenantId, command.activityAuthority.kind === 'self_service'],
  );
  if (updated.rowCount !== 1) throw new DomainError('invalid_state', 'Autoridade exclusiva do agente');
  await revokeAccess(client, principal.tenantId, command.agentId, revokedSessionIds);
  await writeAudit(client, principal.tenantId, principal.agentId, command.kind, 'agent', command.agentId);
}

async function resetCredential(
  client: PoolClient,
  principal: AgentPrincipal,
  agentId: string,
  password: string,
  revokedSessionIds: string[],
): Promise<void> {
  const passwordHash = await hashPassword(password);
  const updated = await client.query(
    `UPDATE agents SET password_hash = $3 WHERE id = $1 AND tenant_id = $2`,
    [agentId, principal.tenantId, passwordHash],
  );
  if (updated.rowCount !== 1) throw new DomainError('not_found', 'Pessoa não encontrada');
  await revokeAccess(client, principal.tenantId, agentId, revokedSessionIds);
  await writeAudit(client, principal.tenantId, principal.agentId, 'agent.credential_reset', 'agent', agentId);
}

async function revokeAgentSessions(
  client: PoolClient,
  principal: AgentPrincipal,
  agentId: string,
  revokedSessionIds: string[],
): Promise<void> {
  const agent = await client.query(`SELECT id FROM agents WHERE id = $1 AND tenant_id = $2`, [
    agentId,
    principal.tenantId,
  ]);
  if (!agent.rows[0]) throw new DomainError('not_found', 'Pessoa não encontrada');
  await revokeAccess(client, principal.tenantId, agentId, revokedSessionIds);
  await writeAudit(client, principal.tenantId, principal.agentId, 'agent.sessions_revoke', 'agent', agentId);
}

async function assertNotLastAdmin(client: PoolClient, tenantId: string, agentId: string): Promise<void> {
  const target = await client.query<{ role: string; membership_status: string }>(
    `SELECT role, membership_status FROM agents WHERE id = $1 AND tenant_id = $2`,
    [agentId, tenantId],
  );
  const person = target.rows[0];
  if (!person) throw new DomainError('not_found', 'Pessoa não encontrada');
  if (person.role !== 'admin' || person.membership_status !== 'active') return;
  const others = await client.query<{ total: number }>(
    `SELECT count(*)::int AS total
     FROM agents
     WHERE tenant_id = $1 AND role = 'admin' AND membership_status = 'active' AND id <> $2`,
    [tenantId, agentId],
  );
  if ((others.rows[0]?.total ?? 0) === 0) {
    throw new DomainError('invalid_state', 'A empresa precisa de um administrador ativo');
  }
}

async function revokeAccess(
  client: PoolClient,
  tenantId: string,
  agentId: string,
  revokedSessionIds: string[],
): Promise<void> {
  await client.query(`UPDATE agents SET auth_epoch = auth_epoch + 1 WHERE id = $1 AND tenant_id = $2`, [
    agentId,
    tenantId,
  ]);
  const deleted = await client.query<{ id: string }>(
    `DELETE FROM auth_sessions WHERE agent_id = $1 AND tenant_id = $2 RETURNING id`,
    [agentId, tenantId],
  );
  for (const row of deleted.rows) revokedSessionIds.push(row.id);
}

async function publishSurvey(
  client: PoolClient,
  principal: AgentPrincipal,
  command: Extract<CompanyCommand, { kind: 'survey.publish' }>,
): Promise<void> {
  await client.query(`UPDATE survey_definitions SET active = false WHERE tenant_id = $1 AND active = true`, [
    principal.tenantId,
  ]);
  const inserted = await client.query<{ id: string }>(
    `INSERT INTO survey_definitions (tenant_id, prompt, scale, comment_enabled, active)
     VALUES ($1, $2, $3, $4, true)
     RETURNING id`,
    [principal.tenantId, command.prompt, command.scale, command.comment === 'enabled'],
  );
  const surveyId = inserted.rows[0]?.id;
  if (!surveyId) throw new DomainError('internal', 'Pesquisa não publicada');
  await writeAudit(client, principal.tenantId, principal.agentId, command.kind, 'survey', surveyId);
}
