-- Fase 5: administração da empresa (fuso, suspensão, recibos de comandos, SLA e qualidade).
-- Aplicada pelo migrate.ts na inicialização do servidor, como as demais migrations.
-- O controle é pelo nome do arquivo em schema_migrations; não altere o SQL depois de publicado.

ALTER TABLE tenants
  ADD COLUMN time_zone text NOT NULL DEFAULT 'America/Sao_Paulo';

ALTER TABLE tenants
  ADD CONSTRAINT tenants_time_zone_len CHECK (char_length(time_zone) BETWEEN 1 AND 64),
  ADD CONSTRAINT tenants_name_len CHECK (char_length(name) BETWEEN 1 AND 120);

ALTER TABLE agents
  ADD COLUMN membership_status text NOT NULL DEFAULT 'active',
  ADD COLUMN suspended_at timestamptz,
  ADD COLUMN suspension_reason text;

ALTER TABLE agents
  ADD COLUMN auth_epoch bigint NOT NULL DEFAULT 1;

ALTER TABLE agents
  ADD CONSTRAINT agents_auth_epoch_check CHECK (auth_epoch >= 1);

ALTER TABLE auth_sessions
  ADD COLUMN auth_epoch bigint NOT NULL DEFAULT 1;

ALTER TABLE auth_sessions
  ADD CONSTRAINT auth_sessions_auth_epoch_check CHECK (auth_epoch >= 1);

ALTER TABLE agents
  ADD CONSTRAINT agents_membership_status_check
    CHECK (membership_status IN ('active', 'suspended')),
  ADD CONSTRAINT agents_membership_pair CHECK (
    (membership_status = 'active' AND suspended_at IS NULL AND suspension_reason IS NULL)
    OR (
      membership_status = 'suspended'
      AND suspended_at IS NOT NULL
      AND suspension_reason IS NOT NULL
      AND char_length(suspension_reason) BETWEEN 1 AND 200
    )
  ),
  ADD CONSTRAINT agents_name_len CHECK (char_length(name) BETWEEN 1 AND 120),
  ADD CONSTRAINT agents_email_len CHECK (char_length(email) BETWEEN 3 AND 200);

ALTER TABLE queues
  ADD CONSTRAINT queues_name_len CHECK (char_length(name) BETWEEN 1 AND 120);

ALTER TABLE dispositions
  ADD COLUMN status text NOT NULL DEFAULT 'active',
  ADD COLUMN retired_at timestamptz;

ALTER TABLE dispositions
  ADD CONSTRAINT dispositions_name_len CHECK (char_length(name) BETWEEN 1 AND 120),
  ADD CONSTRAINT dispositions_status_check CHECK (status IN ('active', 'retired')),
  ADD CONSTRAINT dispositions_status_pair CHECK (
    (status = 'active' AND retired_at IS NULL)
    OR (status = 'retired' AND retired_at IS NOT NULL)
  );

ALTER TABLE sites
  ADD COLUMN acceptance text,
  ADD COLUMN pause_reason text,
  ADD CONSTRAINT sites_name_len CHECK (char_length(name) BETWEEN 1 AND 120);

UPDATE sites
SET acceptance = CASE WHEN accepting_chats THEN 'accepting' ELSE 'paused' END,
    pause_reason = CASE WHEN accepting_chats THEN NULL ELSE 'Suspenso fora do cadastro' END;

ALTER TABLE sites
  ALTER COLUMN acceptance SET NOT NULL,
  ALTER COLUMN acceptance SET DEFAULT 'accepting';

ALTER TABLE sites
  ADD CONSTRAINT sites_acceptance_check CHECK (acceptance IN ('accepting', 'paused')),
  ADD CONSTRAINT sites_pause_reason_pair CHECK (
    (acceptance = 'accepting' AND pause_reason IS NULL)
    OR (
      acceptance = 'paused'
      AND pause_reason IS NOT NULL
      AND char_length(pause_reason) BETWEEN 1 AND 200
    )
  );

CREATE OR REPLACE FUNCTION sync_site_acceptance()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND NEW.accepting_chats IS DISTINCT FROM OLD.accepting_chats
     AND NEW.acceptance IS NOT DISTINCT FROM OLD.acceptance THEN
    IF NEW.accepting_chats THEN
      NEW.acceptance := 'accepting';
      NEW.pause_reason := NULL;
    ELSE
      NEW.acceptance := 'paused';
      IF NEW.pause_reason IS NULL THEN
        NEW.pause_reason := 'Suspenso fora do cadastro';
      END IF;
    END IF;
  ELSE
    NEW.accepting_chats := NEW.acceptance = 'accepting';
    IF NEW.acceptance = 'accepting' THEN
      NEW.pause_reason := NULL;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER sites_acceptance_sync
  BEFORE INSERT OR UPDATE ON sites
  FOR EACH ROW
  EXECUTE FUNCTION sync_site_acceptance();

CREATE OR REPLACE FUNCTION enforce_site_origins_when_accepting()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.acceptance = 'accepting' AND cardinality(NEW.allowed_origins) < 1 THEN
    RAISE EXCEPTION 'accepting site requires allowed origins';
  END IF;
  RETURN NEW;
END;
$$;

UPDATE sites
SET acceptance = 'paused',
    pause_reason = 'Aguardando origens permitidas'
WHERE acceptance = 'accepting'
  AND cardinality(allowed_origins) < 1;

CREATE TRIGGER sites_origins_when_accepting
  BEFORE INSERT OR UPDATE ON sites
  FOR EACH ROW
  EXECUTE FUNCTION enforce_site_origins_when_accepting();

CREATE OR REPLACE FUNCTION enforce_tenant_time_zone()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  BEGIN
    PERFORM now() AT TIME ZONE NEW.time_zone;
  EXCEPTION
    WHEN invalid_parameter_value THEN
      RAISE EXCEPTION 'invalid time zone';
  END;
  RETURN NEW;
END;
$$;

CREATE TRIGGER tenants_time_zone
  BEFORE INSERT OR UPDATE OF time_zone ON tenants
  FOR EACH ROW
  EXECUTE FUNCTION enforce_tenant_time_zone();

CREATE TABLE site_service_windows (
  site_id uuid NOT NULL REFERENCES sites (id),
  tenant_id uuid NOT NULL REFERENCES tenants (id),
  weekday smallint NOT NULL CHECK (weekday BETWEEN 1 AND 7),
  start_minute smallint NOT NULL CHECK (start_minute BETWEEN 0 AND 1439),
  end_minute smallint NOT NULL CHECK (end_minute BETWEEN 1 AND 1440),
  PRIMARY KEY (site_id, weekday, start_minute),
  CHECK (end_minute > start_minute)
);

CREATE INDEX site_service_windows_tenant ON site_service_windows (tenant_id, site_id);

CREATE OR REPLACE FUNCTION enforce_site_service_window()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM sites AS site
    WHERE site.id = NEW.site_id
      AND site.tenant_id = NEW.tenant_id
  ) THEN
    RAISE EXCEPTION 'service window tenant mismatch';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM site_service_windows AS other
    WHERE other.site_id = NEW.site_id
      AND other.weekday = NEW.weekday
      AND other.start_minute <> NEW.start_minute
      AND other.start_minute < NEW.end_minute
      AND NEW.start_minute < other.end_minute
  ) THEN
    RAISE EXCEPTION 'service window overlap';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER site_service_windows_scope
  BEFORE INSERT OR UPDATE ON site_service_windows
  FOR EACH ROW
  EXECUTE FUNCTION enforce_site_service_window();

CREATE TABLE sla_policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants (id),
  queue_id uuid NOT NULL REFERENCES queues (id),
  status text NOT NULL CHECK (status IN ('active', 'retired')),
  effective_from timestamptz NOT NULL,
  retired_at timestamptz,
  created_by uuid NOT NULL REFERENCES agents (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (status = 'active' AND retired_at IS NULL)
    OR (status = 'retired' AND retired_at IS NOT NULL AND retired_at >= effective_from)
  )
);

CREATE UNIQUE INDEX sla_policies_one_active
  ON sla_policies (queue_id)
  WHERE status = 'active';

CREATE INDEX sla_policies_queue_effective
  ON sla_policies (tenant_id, queue_id, effective_from DESC);

CREATE OR REPLACE FUNCTION enforce_sla_policy()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM queues AS queue
    JOIN agents AS agent ON agent.tenant_id = queue.tenant_id
    WHERE queue.id = NEW.queue_id
      AND queue.tenant_id = NEW.tenant_id
      AND agent.id = NEW.created_by
  ) THEN
    RAISE EXCEPTION 'sla policy tenant mismatch';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER sla_policies_scope
  BEFORE INSERT OR UPDATE ON sla_policies
  FOR EACH ROW
  EXECUTE FUNCTION enforce_sla_policy();

CREATE TABLE sla_policy_clocks (
  policy_id uuid NOT NULL REFERENCES sla_policies (id),
  tenant_id uuid NOT NULL REFERENCES tenants (id),
  metric text NOT NULL CHECK (metric IN ('queue_wait', 'first_response')),
  threshold_seconds integer NOT NULL CHECK (threshold_seconds BETWEEN 1 AND 86400),
  PRIMARY KEY (policy_id, metric)
);

CREATE OR REPLACE FUNCTION enforce_sla_clock()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM sla_policies AS policy
    WHERE policy.id = NEW.policy_id
      AND policy.tenant_id = NEW.tenant_id
  ) THEN
    RAISE EXCEPTION 'sla clock tenant mismatch';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER sla_policy_clocks_scope
  BEFORE INSERT OR UPDATE ON sla_policy_clocks
  FOR EACH ROW
  EXECUTE FUNCTION enforce_sla_clock();

CREATE OR REPLACE FUNCTION enforce_sla_clocks_complete()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF (
    SELECT count(DISTINCT metric)
    FROM sla_policy_clocks
    WHERE policy_id = NEW.id
      AND metric IN ('queue_wait', 'first_response')
  ) <> 2 THEN
    RAISE EXCEPTION 'sla policy requires queue_wait and first_response';
  END IF;
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER sla_policies_clocks_complete
  AFTER INSERT OR UPDATE ON sla_policies
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  EXECUTE FUNCTION enforce_sla_clocks_complete();

CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE sla_policies
  ADD CONSTRAINT sla_policies_no_overlap
  EXCLUDE USING gist (
    queue_id WITH =,
    tstzrange(effective_from, retired_at, '[)') WITH &&
  );

CREATE OR REPLACE FUNCTION enforce_sla_publication()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  previous_retired_at timestamptz;
BEGIN
  IF NEW.effective_from < now() THEN
    RAISE EXCEPTION 'retroactive sla publication';
  END IF;
  SELECT policy.retired_at
    INTO previous_retired_at
  FROM sla_policies AS policy
  WHERE policy.queue_id = NEW.queue_id
    AND policy.id <> NEW.id
  ORDER BY policy.effective_from DESC
  LIMIT 1;
  IF NOT FOUND THEN
    RETURN NEW;
  END IF;
  IF previous_retired_at IS NULL THEN
    RAISE EXCEPTION 'open sla must be closed before insert';
  END IF;
  IF previous_retired_at > now() AND previous_retired_at <> NEW.effective_from THEN
    RAISE EXCEPTION 'future sla leaves a gap';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER sla_policies_publication
  BEFORE INSERT ON sla_policies
  FOR EACH ROW
  EXECUTE FUNCTION enforce_sla_publication();

CREATE TABLE company_command_receipts (
  tenant_id uuid NOT NULL REFERENCES tenants (id),
  actor_id uuid NOT NULL REFERENCES agents (id),
  request_id uuid NOT NULL,
  command_kind text NOT NULL CHECK (char_length(command_kind) BETWEEN 1 AND 80),
  payload_hash text NOT NULL CHECK (payload_hash ~ '^[0-9a-f]{64}$'),
  status text NOT NULL CHECK (status IN ('in_flight', 'applied')),
  applied_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, actor_id, request_id),
  CHECK (
    (status = 'in_flight' AND applied_at IS NULL)
    OR (status = 'applied' AND applied_at IS NOT NULL)
  )
);

CREATE OR REPLACE FUNCTION enforce_company_command_actor()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM agents AS agent
    WHERE agent.id = NEW.actor_id
      AND agent.tenant_id = NEW.tenant_id
  ) THEN
    RAISE EXCEPTION 'company command actor tenant mismatch';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER company_command_receipts_scope
  BEFORE INSERT OR UPDATE ON company_command_receipts
  FOR EACH ROW
  EXECUTE FUNCTION enforce_company_command_actor();

CREATE OR REPLACE FUNCTION notify_auth_session_revoked()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM pg_notify(
    'webchat_session_revoke',
    json_build_object(
      'tenantId', OLD.tenant_id,
      'agentId', OLD.agent_id,
      'sessionId', OLD.id
    )::text
  );
  RETURN OLD;
END;
$$;

CREATE TRIGGER auth_sessions_revoke_notify
  AFTER DELETE ON auth_sessions
  FOR EACH ROW
  EXECUTE FUNCTION notify_auth_session_revoked();

WITH ranked AS (
  SELECT id, row_number() OVER (PARTITION BY tenant_id ORDER BY created_at ASC, id ASC) AS position
  FROM survey_definitions
  WHERE active = true
)
UPDATE survey_definitions AS survey
SET active = false
FROM ranked
WHERE survey.id = ranked.id
  AND ranked.position > 1;

CREATE UNIQUE INDEX survey_definitions_one_active
  ON survey_definitions (tenant_id)
  WHERE active = true;

CREATE INDEX conversation_events_conversation_time
  ON conversation_events (conversation_id, created_at);

CREATE INDEX conversation_events_tenant_time
  ON conversation_events (tenant_id, created_at);

CREATE INDEX survey_responses_tenant_time
  ON survey_responses (tenant_id, created_at DESC);

CREATE INDEX audit_events_tenant_action_time
  ON audit_events (tenant_id, action, created_at DESC);

ALTER TABLE company_command_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE company_command_receipts FORCE ROW LEVEL SECURITY;
ALTER TABLE site_service_windows ENABLE ROW LEVEL SECURITY;
ALTER TABLE site_service_windows FORCE ROW LEVEL SECURITY;
ALTER TABLE sla_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE sla_policies FORCE ROW LEVEL SECURITY;
ALTER TABLE sla_policy_clocks ENABLE ROW LEVEL SECURITY;
ALTER TABLE sla_policy_clocks FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON company_command_receipts
  USING (tenant_id = app_tenant_id())
  WITH CHECK (tenant_id = app_tenant_id());

CREATE POLICY tenant_isolation ON site_service_windows
  USING (tenant_id = app_tenant_id())
  WITH CHECK (tenant_id = app_tenant_id());

CREATE POLICY tenant_isolation ON sla_policies
  USING (tenant_id = app_tenant_id())
  WITH CHECK (tenant_id = app_tenant_id());

CREATE POLICY tenant_isolation ON sla_policy_clocks
  USING (tenant_id = app_tenant_id())
  WITH CHECK (tenant_id = app_tenant_id());

GRANT SELECT (membership_status, suspended_at, suspension_reason, auth_epoch) ON agents TO webchat_app;
GRANT UPDATE (auth_epoch, password_hash) ON agents TO webchat_app;
GRANT INSERT (auth_epoch) ON auth_sessions TO webchat_app;
GRANT SELECT (auth_epoch) ON auth_sessions TO webchat_app;
GRANT INSERT (
  tenant_id,
  email,
  name,
  password_hash,
  role,
  can_change_own_activity,
  membership_status,
  suspended_at,
  suspension_reason
) ON agents TO webchat_app;
GRANT UPDATE (
  name,
  role,
  can_change_own_activity,
  membership_status,
  suspended_at,
  suspension_reason
) ON agents TO webchat_app;

GRANT SELECT, INSERT, DELETE ON site_service_windows TO webchat_app;
GRANT SELECT, INSERT ON sla_policies TO webchat_app;
GRANT UPDATE (status, retired_at) ON sla_policies TO webchat_app;
GRANT SELECT, INSERT ON sla_policy_clocks TO webchat_app;
GRANT SELECT, INSERT ON company_command_receipts TO webchat_app;
GRANT UPDATE (status, applied_at) ON company_command_receipts TO webchat_app;

REVOKE UPDATE, DELETE ON audit_events FROM webchat_app;

GRANT EXECUTE ON FUNCTION sync_site_acceptance() TO webchat_app;
GRANT EXECUTE ON FUNCTION enforce_tenant_time_zone() TO webchat_app;
GRANT EXECUTE ON FUNCTION enforce_site_service_window() TO webchat_app;
GRANT EXECUTE ON FUNCTION enforce_sla_policy() TO webchat_app;
GRANT EXECUTE ON FUNCTION enforce_sla_clock() TO webchat_app;
GRANT EXECUTE ON FUNCTION enforce_sla_clocks_complete() TO webchat_app;
GRANT EXECUTE ON FUNCTION enforce_sla_publication() TO webchat_app;
GRANT EXECUTE ON FUNCTION enforce_site_origins_when_accepting() TO webchat_app;
GRANT EXECUTE ON FUNCTION enforce_company_command_actor() TO webchat_app;
GRANT EXECUTE ON FUNCTION notify_auth_session_revoked() TO webchat_app;

CREATE OR REPLACE FUNCTION lookup_agent_by_email(p_email text)
RETURNS TABLE (
  id uuid,
  tenant_id uuid,
  email text,
  name text,
  password_hash text,
  role text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT agent.id, agent.tenant_id, agent.email, agent.name, agent.password_hash, agent.role
  FROM agents AS agent
  WHERE agent.email = p_email
    AND agent.membership_status = 'active'
$$;

CREATE OR REPLACE FUNCTION lookup_auth_session(p_token_hash text)
RETURNS TABLE (
  session_id uuid,
  agent_id uuid,
  tenant_id uuid,
  role text,
  name text,
  expires_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT session.id, session.agent_id, session.tenant_id, agent.role, agent.name, session.expires_at
  FROM auth_sessions AS session
  JOIN agents AS agent
    ON agent.id = session.agent_id
   AND agent.tenant_id = session.tenant_id
  WHERE session.token_hash = p_token_hash
    AND session.expires_at > now()
    AND agent.membership_status = 'active'
    AND session.auth_epoch = agent.auth_epoch
$$;
