DO $$
DECLARE
  constraint_name text;
BEGIN
  SELECT con.conname INTO constraint_name
  FROM pg_constraint AS con
  JOIN pg_class AS rel ON rel.oid = con.conrelid
  JOIN pg_namespace AS namespace ON namespace.oid = rel.relnamespace
  JOIN pg_attribute AS att ON att.attrelid = rel.oid AND att.attnum = ANY (con.conkey)
  WHERE namespace.nspname = 'public'
    AND rel.relname = 'agents'
    AND att.attname = 'role'
    AND con.contype = 'c';
  IF constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE agents DROP CONSTRAINT %I', constraint_name);
  END IF;
END
$$;

ALTER TABLE agents
  ADD CONSTRAINT agents_role_check CHECK (role IN ('agent', 'supervisor', 'admin'));

DO $$
DECLARE
  constraint_name text;
BEGIN
  SELECT con.conname INTO constraint_name
  FROM pg_constraint AS con
  JOIN pg_class AS rel ON rel.oid = con.conrelid
  JOIN pg_namespace AS namespace ON namespace.oid = rel.relnamespace
  JOIN pg_attribute AS att ON att.attrelid = rel.oid AND att.attnum = ANY (con.conkey)
  WHERE namespace.nspname = 'public'
    AND rel.relname = 'auth_sessions'
    AND att.attname = 'role'
    AND con.contype = 'c';
  IF constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE auth_sessions DROP CONSTRAINT %I', constraint_name);
  END IF;
END
$$;

ALTER TABLE auth_sessions
  ADD CONSTRAINT auth_sessions_role_check CHECK (role IN ('agent', 'supervisor', 'admin'));

ALTER TABLE agents
  ADD COLUMN can_change_own_activity boolean NOT NULL DEFAULT false;

ALTER TABLE tenants
  ADD COLUMN internal_history_policy text NOT NULL DEFAULT 'retain_until_removed';

ALTER TABLE tenants
  ADD CONSTRAINT tenants_internal_history_policy_check
  CHECK (internal_history_policy = 'retain_until_removed');

CREATE TABLE sectors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants (id),
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
  description text NOT NULL DEFAULT '' CHECK (char_length(description) <= 500),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, name)
);

CREATE INDEX sectors_tenant_active ON sectors (tenant_id, active);

CREATE TABLE sector_members (
  sector_id uuid NOT NULL REFERENCES sectors (id),
  agent_id uuid NOT NULL REFERENCES agents (id),
  tenant_id uuid NOT NULL REFERENCES tenants (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  removed_at timestamptz,
  PRIMARY KEY (sector_id, agent_id)
);

CREATE INDEX sector_members_active_agent ON sector_members (tenant_id, agent_id) WHERE removed_at IS NULL;

CREATE TABLE sector_supervisors (
  sector_id uuid NOT NULL REFERENCES sectors (id),
  agent_id uuid NOT NULL REFERENCES agents (id),
  tenant_id uuid NOT NULL REFERENCES tenants (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  removed_at timestamptz,
  PRIMARY KEY (sector_id, agent_id)
);

CREATE INDEX sector_supervisors_active_agent ON sector_supervisors (tenant_id, agent_id) WHERE removed_at IS NULL;

CREATE TABLE sector_queues (
  sector_id uuid NOT NULL REFERENCES sectors (id),
  queue_id uuid NOT NULL REFERENCES queues (id),
  tenant_id uuid NOT NULL REFERENCES tenants (id),
  PRIMARY KEY (sector_id, queue_id)
);

CREATE TABLE audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants (id),
  actor_id uuid NOT NULL REFERENCES agents (id),
  action text NOT NULL CHECK (char_length(action) BETWEEN 1 AND 80),
  resource_type text NOT NULL CHECK (char_length(resource_type) BETWEEN 1 AND 40),
  resource_id uuid,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX audit_events_tenant_time ON audit_events (tenant_id, created_at DESC);

CREATE OR REPLACE FUNCTION enforce_sector_member()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM sectors AS sector
    JOIN agents AS agent ON agent.tenant_id = sector.tenant_id
    WHERE sector.id = NEW.sector_id
      AND agent.id = NEW.agent_id
      AND sector.tenant_id = NEW.tenant_id
  ) THEN
    RAISE EXCEPTION 'sector member tenant mismatch';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER sector_members_scope
  BEFORE INSERT OR UPDATE ON sector_members
  FOR EACH ROW
  EXECUTE FUNCTION enforce_sector_member();

CREATE OR REPLACE FUNCTION enforce_sector_supervisor()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM sectors AS sector
    JOIN agents AS agent ON agent.tenant_id = sector.tenant_id
    WHERE sector.id = NEW.sector_id
      AND agent.id = NEW.agent_id
      AND sector.tenant_id = NEW.tenant_id
      AND agent.role IN ('supervisor', 'admin')
  ) THEN
    RAISE EXCEPTION 'sector supervisor tenant mismatch';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER sector_supervisors_scope
  BEFORE INSERT OR UPDATE ON sector_supervisors
  FOR EACH ROW
  EXECUTE FUNCTION enforce_sector_supervisor();

CREATE OR REPLACE FUNCTION enforce_sector_queue()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM sectors AS sector
    JOIN queues AS queue ON queue.tenant_id = sector.tenant_id
    WHERE sector.id = NEW.sector_id
      AND queue.id = NEW.queue_id
      AND sector.tenant_id = NEW.tenant_id
  ) THEN
    RAISE EXCEPTION 'sector queue tenant mismatch';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER sector_queues_scope
  BEFORE INSERT OR UPDATE ON sector_queues
  FOR EACH ROW
  EXECUTE FUNCTION enforce_sector_queue();

CREATE OR REPLACE FUNCTION enforce_audit_actor()
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
    RAISE EXCEPTION 'audit actor tenant mismatch';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER audit_events_scope
  BEFORE INSERT OR UPDATE ON audit_events
  FOR EACH ROW
  EXECUTE FUNCTION enforce_audit_actor();

ALTER TABLE sectors ENABLE ROW LEVEL SECURITY;
ALTER TABLE sectors FORCE ROW LEVEL SECURITY;
ALTER TABLE sector_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE sector_members FORCE ROW LEVEL SECURITY;
ALTER TABLE sector_supervisors ENABLE ROW LEVEL SECURITY;
ALTER TABLE sector_supervisors FORCE ROW LEVEL SECURITY;
ALTER TABLE sector_queues ENABLE ROW LEVEL SECURITY;
ALTER TABLE sector_queues FORCE ROW LEVEL SECURITY;
ALTER TABLE audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_events FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON sectors
  USING (tenant_id = app_tenant_id())
  WITH CHECK (tenant_id = app_tenant_id());

CREATE POLICY tenant_isolation ON sector_members
  USING (tenant_id = app_tenant_id())
  WITH CHECK (tenant_id = app_tenant_id());

CREATE POLICY tenant_isolation ON sector_supervisors
  USING (tenant_id = app_tenant_id())
  WITH CHECK (tenant_id = app_tenant_id());

CREATE POLICY tenant_isolation ON sector_queues
  USING (tenant_id = app_tenant_id())
  WITH CHECK (tenant_id = app_tenant_id());

CREATE POLICY tenant_isolation ON audit_events
  USING (tenant_id = app_tenant_id())
  WITH CHECK (tenant_id = app_tenant_id());

GRANT SELECT (can_change_own_activity) ON agents TO webchat_app;

GRANT SELECT, INSERT, UPDATE, DELETE ON
  sectors,
  sector_members,
  sector_supervisors,
  sector_queues,
  audit_events
TO webchat_app;

GRANT EXECUTE ON FUNCTION enforce_sector_member() TO webchat_app;
GRANT EXECUTE ON FUNCTION enforce_sector_supervisor() TO webchat_app;
GRANT EXECUTE ON FUNCTION enforce_sector_queue() TO webchat_app;
GRANT EXECUTE ON FUNCTION enforce_audit_actor() TO webchat_app;
