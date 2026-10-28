import { companyDeskSchema, type CompanyDesk } from '@viavoip/protocol';
import type { PoolClient } from 'pg';

type TenantRow = {
  name: string;
  slug: string;
  time_zone: string;
  max_concurrent_assignments: number;
  internal_history_policy: 'retain_until_removed';
};

type SiteRow = {
  id: string;
  public_id: string;
  name: string;
  primary_color: string;
  logo_url: string | null;
  welcome_message: string;
  require_visitor_name: boolean;
  acceptance: 'accepting' | 'paused';
  pause_reason: string | null;
  allowed_origins: string[];
};

type WindowRow = {
  site_id: string;
  weekday: number;
  start_minute: number;
  end_minute: number;
};

type AgentRow = {
  id: string;
  email: string;
  name: string;
  role: 'agent' | 'supervisor' | 'admin';
  membership_status: 'active' | 'suspended';
  suspended_at: Date | null;
  suspension_reason: string | null;
  can_change_own_activity: boolean;
};

type DispositionRow = {
  id: string;
  name: string;
  status: 'active' | 'retired';
  retired_at: Date | null;
};

type SurveyRow = {
  id: string;
  prompt: string;
  scale: number;
  comment_enabled: boolean;
};

type SlaRow = {
  id: string;
  queue_id: string;
  status: 'active' | 'retired';
  effective_from: Date;
  retired_at: Date | null;
  queue_wait: number;
  first_response: number;
};

export async function readCompanyDesk(client: PoolClient, tenantId: string): Promise<CompanyDesk> {
  const tenant = await client.query<TenantRow>(
    `SELECT name, slug, time_zone, max_concurrent_assignments, internal_history_policy
     FROM tenants WHERE id = $1`,
    [tenantId],
  );
  const company = tenant.rows[0];
  if (!company) throw new Error('Empresa ausente na sessão');
  const sites = await client.query<SiteRow>(
    `SELECT id, public_id, name, primary_color, logo_url, welcome_message, require_visitor_name,
            acceptance, pause_reason, allowed_origins
     FROM sites WHERE tenant_id = $1 ORDER BY public_id`,
    [tenantId],
  );
  const windows = await client.query<WindowRow>(
    `SELECT site_id, weekday, start_minute, end_minute
     FROM site_service_windows WHERE tenant_id = $1
     ORDER BY site_id, weekday, start_minute`,
    [tenantId],
  );
  const queues = await client.query<{ id: string; name: string }>(
    `SELECT id, name FROM queues WHERE tenant_id = $1 ORDER BY name`,
    [tenantId],
  );
  const dispositions = await client.query<DispositionRow>(
    `SELECT id, name, status, retired_at FROM dispositions WHERE tenant_id = $1 ORDER BY name`,
    [tenantId],
  );
  const survey = await client.query<SurveyRow>(
    `SELECT id, prompt, scale, comment_enabled
     FROM survey_definitions
     WHERE tenant_id = $1 AND active = true
     ORDER BY created_at ASC
     LIMIT 1`,
    [tenantId],
  );
  const agents = await client.query<AgentRow>(
    `SELECT id, email, name, role, membership_status, suspended_at, suspension_reason, can_change_own_activity
     FROM agents WHERE tenant_id = $1 ORDER BY email`,
    [tenantId],
  );
  const links = await client.query<{ agent_id: string; queue_id: string }>(
    `SELECT agent_id, queue_id FROM agent_queues WHERE tenant_id = $1 ORDER BY queue_id`,
    [tenantId],
  );
  const policies = await client.query<SlaRow>(
    `SELECT policy.id, policy.queue_id, policy.status, policy.effective_from, policy.retired_at,
            wait.threshold_seconds AS queue_wait, reply.threshold_seconds AS first_response
     FROM sla_policies AS policy
     JOIN sla_policy_clocks AS wait
       ON wait.policy_id = policy.id AND wait.metric = 'queue_wait'
     JOIN sla_policy_clocks AS reply
       ON reply.policy_id = policy.id AND reply.metric = 'first_response'
     WHERE policy.tenant_id = $1
     ORDER BY policy.effective_from`,
    [tenantId],
  );
  const queuesByAgent = new Map<string, string[]>();
  for (const link of links.rows) {
    const current = queuesByAgent.get(link.agent_id) ?? [];
    current.push(link.queue_id);
    queuesByAgent.set(link.agent_id, current);
  }
  const windowsBySite = new Map<string, WindowRow[]>();
  for (const window of windows.rows) {
    const current = windowsBySite.get(window.site_id) ?? [];
    current.push(window);
    windowsBySite.set(window.site_id, current);
  }
  const activeSurvey = survey.rows[0];
  return companyDeskSchema.parse({
    company: {
      name: company.name,
      slug: company.slug,
      timeZone: company.time_zone,
      concurrencyLimit: company.max_concurrent_assignments,
      internalHistory: { policy: company.internal_history_policy },
    },
    sites: sites.rows.map((site) => ({
      siteId: site.id,
      publicId: site.public_id,
      name: site.name,
      appearance: {
        primaryColor: site.primary_color,
        logo: site.logo_url ? { kind: 'https' as const, url: site.logo_url } : { kind: 'none' as const },
        welcomeMessage: site.welcome_message,
        identity: site.require_visitor_name
          ? { kind: 'name_required' as const }
          : { kind: 'anonymous_allowed' as const },
      },
      acceptance:
        site.acceptance === 'paused'
          ? { kind: 'paused' as const, reason: site.pause_reason ?? 'Suspenso' }
          : { kind: 'accepting' as const },
      calendar: calendarOf(windowsBySite.get(site.id) ?? []),
      allowedOrigins: site.allowed_origins,
    })),
    queues: queues.rows,
    dispositions: dispositions.rows.map((item) => ({
      id: item.id,
      name: item.name,
      publication:
        item.status === 'retired'
          ? { status: 'retired' as const, retiredAt: requiredDate(item.retired_at) }
          : { status: 'active' as const },
    })),
    survey: activeSurvey
      ? {
          status: 'active' as const,
          id: activeSurvey.id,
          prompt: activeSurvey.prompt,
          scale: activeSurvey.scale,
          comment: activeSurvey.comment_enabled ? ('enabled' as const) : ('disabled' as const),
        }
      : { status: 'unpublished' as const },
    agents: agents.rows.map((agent) => ({
      agentId: agent.id,
      email: agent.email,
      name: agent.name,
      membership:
        agent.membership_status === 'suspended'
          ? {
              status: 'suspended' as const,
              suspendedAt: requiredDate(agent.suspended_at),
              reason: agent.suspension_reason ?? 'Suspenso',
            }
          : { status: 'active' as const },
      placement: placementOf(agent, queuesByAgent.get(agent.id) ?? []),
    })),
    slaPolicies: policies.rows.map((policy) => ({
      id: policy.id,
      queueId: policy.queue_id,
      queueWait: { metric: 'queue_wait' as const, thresholdSeconds: policy.queue_wait },
      firstResponse: { metric: 'first_response' as const, thresholdSeconds: policy.first_response },
      life:
        policy.status === 'retired'
          ? {
              status: 'retired' as const,
              effectiveFrom: policy.effective_from.toISOString(),
              retiredAt: requiredDate(policy.retired_at),
            }
          : { status: 'active' as const, effectiveFrom: policy.effective_from.toISOString() },
    })),
  });
}

function calendarOf(windows: WindowRow[]): CompanyDesk['sites'][number]['calendar'] {
  if (windows.length === 0) return { kind: 'always_open' };
  return {
    kind: 'weekly',
    windows: windows.map((window) => ({
      weekday: window.weekday,
      startMinute: window.start_minute,
      endMinute: window.end_minute,
    })),
  };
}

function placementOf(agent: AgentRow, queueIds: string[]): CompanyDesk['agents'][number]['placement'] {
  switch (agent.role) {
    case 'agent':
      return {
        role: 'agent',
        queueIds,
        activityAuthority: agent.can_change_own_activity
          ? { kind: 'self_service' }
          : { kind: 'assigned_only' },
      };
    case 'supervisor':
      return { role: 'supervisor' };
    case 'admin':
      return { role: 'admin' };
    default: {
      const unexpected: never = agent.role;
      throw new Error(`Papel inesperado: ${String(unexpected)}`);
    }
  }
}

function requiredDate(value: Date | null): string {
  if (!value) throw new Error('Instante obrigatório ausente');
  return value.toISOString();
}
