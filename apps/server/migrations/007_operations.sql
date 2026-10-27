CREATE TABLE presence_intervals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants (id),
  agent_id uuid NOT NULL REFERENCES agents (id),
  status text NOT NULL CHECK (status IN ('available', 'busy', 'away', 'offline')),
  started_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz
);

CREATE UNIQUE INDEX presence_intervals_one_open
  ON presence_intervals (agent_id)
  WHERE ended_at IS NULL;

CREATE INDEX presence_intervals_agent_time ON presence_intervals (tenant_id, agent_id, started_at);

CREATE TABLE activity_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants (id),
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, name)
);

CREATE TABLE activity_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants (id),
  agent_id uuid NOT NULL REFERENCES agents (id),
  activity_type_id uuid NOT NULL REFERENCES activity_types (id),
  assigned_by uuid NOT NULL REFERENCES agents (id),
  started_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  status text NOT NULL CHECK (status IN ('active', 'finished')),
  CHECK (
    (status = 'active' AND ended_at IS NULL)
    OR (status = 'finished' AND ended_at IS NOT NULL)
  )
);

CREATE UNIQUE INDEX activity_assignments_one_active
  ON activity_assignments (agent_id)
  WHERE ended_at IS NULL;

CREATE INDEX activity_assignments_agent_time ON activity_assignments (tenant_id, agent_id, started_at DESC);

CREATE TRIGGER presence_intervals_agent
  BEFORE INSERT OR UPDATE ON presence_intervals
  FOR EACH ROW
  EXECUTE FUNCTION enforce_agent_scope();

CREATE TRIGGER activity_assignments_agent
  BEFORE INSERT OR UPDATE ON activity_assignments
  FOR EACH ROW
  EXECUTE FUNCTION enforce_agent_scope();

CREATE OR REPLACE FUNCTION enforce_activity_assignment()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM activity_types AS activity_type
    JOIN agents AS assigner ON assigner.tenant_id = activity_type.tenant_id
    WHERE activity_type.id = NEW.activity_type_id
      AND activity_type.tenant_id = NEW.tenant_id
      AND assigner.id = NEW.assigned_by
  ) THEN
    RAISE EXCEPTION 'activity assignment tenant mismatch';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER activity_assignments_scope
  BEFORE INSERT OR UPDATE ON activity_assignments
  FOR EACH ROW
  EXECUTE FUNCTION enforce_activity_assignment();

ALTER TABLE presence_intervals ENABLE ROW LEVEL SECURITY;
ALTER TABLE presence_intervals FORCE ROW LEVEL SECURITY;
ALTER TABLE activity_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE activity_types FORCE ROW LEVEL SECURITY;
ALTER TABLE activity_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE activity_assignments FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON presence_intervals
  USING (tenant_id = app_tenant_id())
  WITH CHECK (tenant_id = app_tenant_id());

CREATE POLICY tenant_isolation ON activity_types
  USING (tenant_id = app_tenant_id())
  WITH CHECK (tenant_id = app_tenant_id());

CREATE POLICY tenant_isolation ON activity_assignments
  USING (tenant_id = app_tenant_id())
  WITH CHECK (tenant_id = app_tenant_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON
  presence_intervals,
  activity_types,
  activity_assignments
TO webchat_app;

GRANT EXECUTE ON FUNCTION enforce_activity_assignment() TO webchat_app;
