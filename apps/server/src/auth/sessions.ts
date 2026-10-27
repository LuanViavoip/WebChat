import type { AuthMe, DispositionSummary, PublicWidget, QueueSummary, Role, VisitorContext } from '@viavoip/protocol';
import { isAllowedOrigin } from '@viavoip/protocol';
import type { Pool, PoolClient } from 'pg';
import { withTenant } from '../db/tenant.js';
import { isStaff } from '../domain/access.js';
import { DomainError } from '../domain/errors.js';
import type { AgentPrincipal, VisitorPrincipal } from '../domain/types.js';
import { hashPassword, verifyPassword } from './passwords.js';
import { hashToken, newToken } from './tokens.js';

type SiteRow = {
  id: string;
  tenant_id: string;
  public_id: string;
  name: string;
  allowed_origins: string[];
  primary_color: string;
  logo_url: string | null;
  welcome_message: string;
  require_visitor_name: boolean;
  accepting_chats: boolean;
};

type AgentRow = {
  id: string;
  tenant_id: string;
  email: string;
  name: string;
  password_hash: string;
  role: Role;
};

type AuthSessionRow = {
  session_id: string;
  agent_id: string;
  tenant_id: string;
  role: Role;
  name: string;
  expires_at: Date;
};

type VisitorSessionRow = {
  session_id: string;
  visitor_id: string;
  site_id: string;
  tenant_id: string;
  expires_at: Date;
};

export class SessionService {
  constructor(
    private readonly pool: Pool,
    private readonly dummyPasswordHash: string,
    private readonly sessionTtlHours: number,
  ) {}

  static async create(pool: Pool, sessionTtlHours: number): Promise<SessionService> {
    const dummyPasswordHash = await hashPassword('not-a-real-password');
    return new SessionService(pool, dummyPasswordHash, sessionTtlHours);
  }

  async publicWidget(sitePublicId: string): Promise<PublicWidget> {
    const site = await this.findSite(sitePublicId);
    const queues = await withTenant(this.pool, site.tenant_id, (client) =>
      listSiteQueues(client, site.id, site.tenant_id),
    );
    return toWidgetSettings(site, queues);
  }

  async createVisitorSession(sitePublicId: string, parentOrigin: string): Promise<VisitorContext & { token: string }> {
    const site = await this.findSite(sitePublicId);
    if (!isAllowedOrigin(parentOrigin, site.allowed_origins)) {
      throw new DomainError('forbidden', 'Origem não autorizada para este site');
    }
    const { token, tokenHash } = newToken();
    const queues = await withTenant(this.pool, site.tenant_id, async (client) => {
      const visitor = await client.query<{ id: string }>(
        `INSERT INTO visitors (tenant_id, site_id)
         VALUES ($1, $2)
         RETURNING id`,
        [site.tenant_id, site.id],
      );
      const visitorId = visitor.rows[0]?.id;
      if (!visitorId) throw new DomainError('internal', 'Falha ao criar visitante');
      await client.query(
        `INSERT INTO visitor_sessions (token_hash, visitor_id, site_id, tenant_id, expires_at)
         VALUES ($1, $2, $3, $4, now() + make_interval(hours => $5::integer))`,
        [tokenHash, visitorId, site.id, site.tenant_id, this.sessionTtlHours],
      );
      return listSiteQueues(client, site.id, site.tenant_id);
    });
    return { token, ...toWidgetSettings(site, queues) };
  }

  async visitorContext(principal: VisitorPrincipal): Promise<VisitorContext> {
    return withTenant(this.pool, principal.tenantId, async (client) => {
      const site = await client.query<SiteSettingsRow>(
        `SELECT name, allowed_origins, primary_color, logo_url, welcome_message, require_visitor_name, accepting_chats
         FROM sites
         WHERE id = $1 AND tenant_id = $2`,
        [principal.siteId, principal.tenantId],
      );
      const row = site.rows[0];
      if (!row) throw new DomainError('not_found', 'Site não encontrado');
      const queues = await listSiteQueues(client, principal.siteId, principal.tenantId);
      return toWidgetSettings(
        {
          name: row.name,
          allowed_origins: row.allowed_origins,
          primary_color: row.primary_color,
          logo_url: row.logo_url,
          welcome_message: row.welcome_message,
          require_visitor_name: row.require_visitor_name,
          accepting_chats: row.accepting_chats,
        },
        queues,
      );
    });
  }

  async authenticateVisitor(token: string): Promise<VisitorPrincipal | null> {
    const result = await this.pool.query<VisitorSessionRow>(
      `SELECT session_id, visitor_id, site_id, tenant_id, expires_at
       FROM lookup_visitor_session($1)`,
      [hashToken(token)],
    );
    const row = result.rows[0];
    if (!row) return null;
    return {
      kind: 'visitor',
      tenantId: row.tenant_id,
      visitorId: row.visitor_id,
      siteId: row.site_id,
      sessionId: row.session_id,
    };
  }

  async login(email: string, password: string): Promise<{ token: string; role: Role; name: string }> {
    const result = await this.pool.query<AgentRow>(
      `SELECT id, tenant_id, email, name, password_hash, role
       FROM lookup_agent_by_email($1)`,
      [email],
    );
    const agent = result.rows[0];
    if (!agent) {
      await verifyPassword(password, this.dummyPasswordHash);
      throw new DomainError('unauthorized', 'Credenciais inválidas');
    }
    const matches = await verifyPassword(password, agent.password_hash);
    if (!matches) throw new DomainError('unauthorized', 'Credenciais inválidas');
    const { token, tokenHash } = newToken();
    await withTenant(this.pool, agent.tenant_id, async (client) => {
      await client.query(
        `INSERT INTO auth_sessions (token_hash, agent_id, tenant_id, role, expires_at)
         VALUES ($1, $2, $3, $4, now() + make_interval(hours => $5::integer))`,
        [tokenHash, agent.id, agent.tenant_id, agent.role, this.sessionTtlHours],
      );
    });
    return { token, role: agent.role, name: agent.name };
  }

  async authenticateAgent(token: string): Promise<AgentPrincipal | null> {
    const result = await this.pool.query<AuthSessionRow>(
      `SELECT session_id, agent_id, tenant_id, role, name, expires_at
       FROM lookup_auth_session($1)`,
      [hashToken(token)],
    );
    const row = result.rows[0];
    if (!row) return null;
    if (row.role !== 'agent' && row.role !== 'supervisor' && row.role !== 'admin') return null;
    return {
      kind: row.role,
      tenantId: row.tenant_id,
      agentId: row.agent_id,
      sessionId: row.session_id,
      name: row.name,
    };
  }

  async logout(principal: AgentPrincipal): Promise<void> {
    await withTenant(this.pool, principal.tenantId, async (client) => {
      await client.query(`DELETE FROM auth_sessions WHERE id = $1 AND tenant_id = $2`, [
        principal.sessionId,
        principal.tenantId,
      ]);
    });
  }

  async agentProfile(principal: AgentPrincipal): Promise<AuthMe> {
    return withTenant(this.pool, principal.tenantId, async (client) => {
      const queues = await listProfileQueues(client, principal);
      const dispositions = await client.query<DispositionSummary>(
        `SELECT id, name
         FROM dispositions
         WHERE tenant_id = $1
         ORDER BY name`,
        [principal.tenantId],
      );
      const limit = await client.query<{ max_concurrent_assignments: number }>(
        `SELECT max_concurrent_assignments FROM tenants WHERE id = $1`,
        [principal.tenantId],
      );
      const maxConcurrentAssignments = limit.rows[0]?.max_concurrent_assignments;
      if (!maxConcurrentAssignments) throw new DomainError('internal', 'Limite do tenant ausente');
      return {
        selfId: principal.agentId,
        name: principal.name,
        role: principal.kind,
        queues: queues.map((queue) => ({ id: queue.id, name: queue.name })),
        dispositions: dispositions.rows.map((item) => ({ id: item.id, name: item.name })),
        maxConcurrentAssignments,
      };
    });
  }

  private async findSite(publicId: string): Promise<SiteRow> {
    const result = await this.pool.query<SiteRow>(
      `SELECT id, tenant_id, public_id, name, allowed_origins, primary_color, logo_url,
              welcome_message, require_visitor_name, accepting_chats
       FROM lookup_site_by_public_id($1)`,
      [publicId],
    );
    const site = result.rows[0];
    if (!site) throw new DomainError('not_found', 'Site não encontrado');
    return site;
  }
}

type SiteSettingsRow = {
  name: string;
  allowed_origins: string[];
  primary_color: string;
  logo_url: string | null;
  welcome_message: string;
  require_visitor_name: boolean;
  accepting_chats: boolean;
};

function toWidgetSettings(site: SiteSettingsRow, queues: QueueSummary[]): PublicWidget {
  return {
    siteName: site.name,
    primaryColor: site.primary_color,
    logoUrl: site.logo_url,
    welcomeMessage: site.welcome_message,
    requireVisitorName: site.require_visitor_name,
    acceptingChats: site.accepting_chats,
    allowedOrigins: site.allowed_origins,
    queues,
  };
}

async function listSiteQueues(client: PoolClient, siteId: string, tenantId: string): Promise<QueueSummary[]> {
  const result = await client.query<QueueSummary>(
    `SELECT queue.id, queue.name
     FROM site_queues AS site_queue
     JOIN queues AS queue ON queue.id = site_queue.queue_id AND queue.tenant_id = site_queue.tenant_id
     WHERE site_queue.site_id = $1 AND site_queue.tenant_id = $2
     ORDER BY queue.name`,
    [siteId, tenantId],
  );
  return result.rows.map((queue) => ({ id: queue.id, name: queue.name }));
}

async function listProfileQueues(client: PoolClient, principal: AgentPrincipal): Promise<QueueSummary[]> {
  if (isStaff(principal.kind)) {
    const result = await client.query<QueueSummary>(
      `SELECT id, name FROM queues WHERE tenant_id = $1 ORDER BY name`,
      [principal.tenantId],
    );
    return result.rows.map((queue) => ({ id: queue.id, name: queue.name }));
  }
  const result = await client.query<QueueSummary>(
    `SELECT queue.id, queue.name
     FROM agent_queues AS agent_queue
     JOIN queues AS queue ON queue.id = agent_queue.queue_id AND queue.tenant_id = agent_queue.tenant_id
     WHERE agent_queue.agent_id = $1 AND agent_queue.tenant_id = $2
     ORDER BY queue.name`,
    [principal.agentId, principal.tenantId],
  );
  return result.rows.map((queue) => ({ id: queue.id, name: queue.name }));
}
