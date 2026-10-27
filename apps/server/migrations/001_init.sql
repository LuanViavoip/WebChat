DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'webchat_app') THEN
    CREATE ROLE webchat_app LOGIN PASSWORD 'webchat_app' NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
  ELSE
    ALTER ROLE webchat_app WITH LOGIN PASSWORD 'webchat_app' NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
  END IF;
END
$$;

DO $$
BEGIN
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO webchat_app', current_database());
END
$$;

GRANT USAGE ON SCHEMA public TO webchat_app;

CREATE TABLE IF NOT EXISTS schema_migrations (
  version text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE tenants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (slug ~ '^[a-z0-9-]+$')
);

CREATE TABLE sites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants (id),
  public_id text NOT NULL UNIQUE,
  name text NOT NULL,
  allowed_origins text[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (public_id ~ '^[a-z0-9_-]+$')
);

CREATE TABLE queues (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants (id),
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, name)
);

CREATE TABLE site_queues (
  site_id uuid NOT NULL REFERENCES sites (id),
  queue_id uuid NOT NULL REFERENCES queues (id),
  tenant_id uuid NOT NULL REFERENCES tenants (id),
  PRIMARY KEY (site_id, queue_id)
);

CREATE TABLE agents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants (id),
  email text NOT NULL UNIQUE,
  name text NOT NULL,
  password_hash text NOT NULL,
  role text NOT NULL CHECK (role IN ('agent', 'supervisor')),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (email = lower(email))
);

CREATE TABLE agent_queues (
  agent_id uuid NOT NULL REFERENCES agents (id),
  queue_id uuid NOT NULL REFERENCES queues (id),
  tenant_id uuid NOT NULL REFERENCES tenants (id),
  PRIMARY KEY (agent_id, queue_id)
);

CREATE TABLE auth_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash text NOT NULL UNIQUE,
  agent_id uuid NOT NULL REFERENCES agents (id),
  tenant_id uuid NOT NULL REFERENCES tenants (id),
  role text NOT NULL CHECK (role IN ('agent', 'supervisor')),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);

CREATE TABLE visitors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants (id),
  site_id uuid NOT NULL REFERENCES sites (id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE visitor_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash text NOT NULL UNIQUE,
  visitor_id uuid NOT NULL REFERENCES visitors (id),
  site_id uuid NOT NULL REFERENCES sites (id),
  tenant_id uuid NOT NULL REFERENCES tenants (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);

CREATE TABLE dispositions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants (id),
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, name)
);

CREATE TABLE survey_definitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants (id),
  prompt text NOT NULL,
  scale integer NOT NULL DEFAULT 5 CHECK (scale BETWEEN 1 AND 5),
  comment_enabled boolean NOT NULL DEFAULT true,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants (id),
  site_id uuid NOT NULL REFERENCES sites (id),
  queue_id uuid NOT NULL REFERENCES queues (id),
  visitor_id uuid NOT NULL REFERENCES visitors (id),
  agent_id uuid REFERENCES agents (id),
  status text NOT NULL CHECK (status IN ('queued', 'assigned', 'awaiting_survey', 'closed')),
  disposition_id uuid REFERENCES dispositions (id),
  version integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  assigned_at timestamptz,
  ended_at timestamptz
);

CREATE UNIQUE INDEX conversations_one_open_per_visitor
  ON conversations (visitor_id)
  WHERE status <> 'closed';

CREATE INDEX conversations_queue_status ON conversations (queue_id, status);
CREATE INDEX conversations_tenant_status ON conversations (tenant_id, status);

CREATE TABLE messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants (id),
  conversation_id uuid NOT NULL REFERENCES conversations (id),
  sender_type text NOT NULL CHECK (sender_type IN ('visitor', 'agent', 'system')),
  sender_id uuid,
  request_id uuid NOT NULL,
  body text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 4000),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (conversation_id, request_id),
  CHECK (
    (sender_type = 'system' AND sender_id IS NULL)
    OR (sender_type <> 'system' AND sender_id IS NOT NULL)
  )
);

CREATE INDEX messages_conversation_order ON messages (conversation_id, created_at, id);

CREATE TABLE conversation_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants (id),
  conversation_id uuid NOT NULL REFERENCES conversations (id),
  type text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE survey_responses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants (id),
  conversation_id uuid NOT NULL UNIQUE REFERENCES conversations (id),
  survey_definition_id uuid NOT NULL REFERENCES survey_definitions (id),
  score integer NOT NULL CHECK (score BETWEEN 1 AND 5),
  comment text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION enforce_site_queue_tenant()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM sites AS site
    JOIN queues AS queue ON queue.tenant_id = site.tenant_id
    WHERE site.id = NEW.site_id
      AND queue.id = NEW.queue_id
      AND site.tenant_id = NEW.tenant_id
  ) THEN
    RAISE EXCEPTION 'site_queue tenant mismatch';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER site_queues_tenant
  BEFORE INSERT OR UPDATE ON site_queues
  FOR EACH ROW
  EXECUTE FUNCTION enforce_site_queue_tenant();

CREATE OR REPLACE FUNCTION enforce_agent_queue_tenant()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM agents AS agent
    JOIN queues AS queue ON queue.tenant_id = agent.tenant_id
    WHERE agent.id = NEW.agent_id
      AND queue.id = NEW.queue_id
      AND agent.tenant_id = NEW.tenant_id
  ) THEN
    RAISE EXCEPTION 'agent_queue tenant mismatch';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER agent_queues_tenant
  BEFORE INSERT OR UPDATE ON agent_queues
  FOR EACH ROW
  EXECUTE FUNCTION enforce_agent_queue_tenant();

CREATE OR REPLACE FUNCTION app_tenant_id()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(current_setting('app.tenant_id', true), '')::uuid
$$;

CREATE OR REPLACE FUNCTION lookup_site_by_public_id(p_public_id text)
RETURNS TABLE (
  id uuid,
  tenant_id uuid,
  public_id text,
  name text,
  allowed_origins text[]
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT site.id, site.tenant_id, site.public_id, site.name, site.allowed_origins
  FROM sites AS site
  WHERE site.public_id = p_public_id
$$;

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
  JOIN agents AS agent ON agent.id = session.agent_id
  WHERE session.token_hash = p_token_hash
    AND session.expires_at > now()
$$;

CREATE OR REPLACE FUNCTION lookup_visitor_session(p_token_hash text)
RETURNS TABLE (
  session_id uuid,
  visitor_id uuid,
  site_id uuid,
  tenant_id uuid,
  expires_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT session.id, session.visitor_id, session.site_id, session.tenant_id, session.expires_at
  FROM visitor_sessions AS session
  WHERE session.token_hash = p_token_hash
    AND session.expires_at > now()
$$;

ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenants FORCE ROW LEVEL SECURITY;
ALTER TABLE sites ENABLE ROW LEVEL SECURITY;
ALTER TABLE sites FORCE ROW LEVEL SECURITY;
ALTER TABLE queues ENABLE ROW LEVEL SECURITY;
ALTER TABLE queues FORCE ROW LEVEL SECURITY;
ALTER TABLE site_queues ENABLE ROW LEVEL SECURITY;
ALTER TABLE site_queues FORCE ROW LEVEL SECURITY;
ALTER TABLE agents ENABLE ROW LEVEL SECURITY;
ALTER TABLE agents FORCE ROW LEVEL SECURITY;
ALTER TABLE agent_queues ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_queues FORCE ROW LEVEL SECURITY;
ALTER TABLE auth_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE auth_sessions FORCE ROW LEVEL SECURITY;
ALTER TABLE visitors ENABLE ROW LEVEL SECURITY;
ALTER TABLE visitors FORCE ROW LEVEL SECURITY;
ALTER TABLE visitor_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE visitor_sessions FORCE ROW LEVEL SECURITY;
ALTER TABLE dispositions ENABLE ROW LEVEL SECURITY;
ALTER TABLE dispositions FORCE ROW LEVEL SECURITY;
ALTER TABLE survey_definitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE survey_definitions FORCE ROW LEVEL SECURITY;
ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversations FORCE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages FORCE ROW LEVEL SECURITY;
ALTER TABLE conversation_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversation_events FORCE ROW LEVEL SECURITY;
ALTER TABLE survey_responses ENABLE ROW LEVEL SECURITY;
ALTER TABLE survey_responses FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_self ON tenants
  USING (id = app_tenant_id())
  WITH CHECK (id = app_tenant_id());

CREATE POLICY tenant_isolation ON sites
  USING (tenant_id = app_tenant_id())
  WITH CHECK (tenant_id = app_tenant_id());

CREATE POLICY tenant_isolation ON queues
  USING (tenant_id = app_tenant_id())
  WITH CHECK (tenant_id = app_tenant_id());

CREATE POLICY tenant_isolation ON site_queues
  USING (tenant_id = app_tenant_id())
  WITH CHECK (tenant_id = app_tenant_id());

CREATE POLICY tenant_isolation ON agents
  USING (tenant_id = app_tenant_id())
  WITH CHECK (tenant_id = app_tenant_id());

CREATE POLICY tenant_isolation ON agent_queues
  USING (tenant_id = app_tenant_id())
  WITH CHECK (tenant_id = app_tenant_id());

CREATE POLICY tenant_isolation ON auth_sessions
  USING (tenant_id = app_tenant_id())
  WITH CHECK (tenant_id = app_tenant_id());

CREATE POLICY tenant_isolation ON visitors
  USING (tenant_id = app_tenant_id())
  WITH CHECK (tenant_id = app_tenant_id());

CREATE POLICY tenant_isolation ON visitor_sessions
  USING (tenant_id = app_tenant_id())
  WITH CHECK (tenant_id = app_tenant_id());

CREATE POLICY tenant_isolation ON dispositions
  USING (tenant_id = app_tenant_id())
  WITH CHECK (tenant_id = app_tenant_id());

CREATE POLICY tenant_isolation ON survey_definitions
  USING (tenant_id = app_tenant_id())
  WITH CHECK (tenant_id = app_tenant_id());

CREATE POLICY tenant_isolation ON conversations
  USING (tenant_id = app_tenant_id())
  WITH CHECK (tenant_id = app_tenant_id());

CREATE POLICY tenant_isolation ON messages
  USING (tenant_id = app_tenant_id())
  WITH CHECK (tenant_id = app_tenant_id());

CREATE POLICY tenant_isolation ON conversation_events
  USING (tenant_id = app_tenant_id())
  WITH CHECK (tenant_id = app_tenant_id());

CREATE POLICY tenant_isolation ON survey_responses
  USING (tenant_id = app_tenant_id())
  WITH CHECK (tenant_id = app_tenant_id());

REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC;

GRANT SELECT, INSERT, UPDATE, DELETE ON
  tenants,
  sites,
  queues,
  site_queues,
  visitors,
  conversations,
  messages,
  conversation_events,
  dispositions,
  survey_definitions,
  survey_responses,
  agent_queues
TO webchat_app;

GRANT SELECT (id, tenant_id, email, name, role, created_at) ON agents TO webchat_app;

GRANT INSERT (token_hash, agent_id, tenant_id, role, expires_at) ON auth_sessions TO webchat_app;
GRANT SELECT (id, agent_id, tenant_id, role, expires_at, created_at) ON auth_sessions TO webchat_app;
GRANT DELETE ON auth_sessions TO webchat_app;

GRANT INSERT (token_hash, visitor_id, site_id, tenant_id, expires_at) ON visitor_sessions TO webchat_app;
GRANT SELECT (id, visitor_id, site_id, tenant_id, expires_at, created_at) ON visitor_sessions TO webchat_app;
GRANT DELETE ON visitor_sessions TO webchat_app;

GRANT EXECUTE ON FUNCTION app_tenant_id() TO webchat_app;
GRANT EXECUTE ON FUNCTION lookup_site_by_public_id(text) TO webchat_app;
GRANT EXECUTE ON FUNCTION lookup_agent_by_email(text) TO webchat_app;
GRANT EXECUTE ON FUNCTION lookup_auth_session(text) TO webchat_app;
GRANT EXECUTE ON FUNCTION lookup_visitor_session(text) TO webchat_app;

REVOKE ALL ON TABLE schema_migrations FROM webchat_app;
