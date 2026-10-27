ALTER TABLE tenants
  ADD COLUMN max_concurrent_assignments integer NOT NULL DEFAULT 3;

ALTER TABLE tenants
  ADD CONSTRAINT tenants_max_concurrent_assignments_range
  CHECK (max_concurrent_assignments BETWEEN 1 AND 100);

ALTER TABLE conversations
  ADD COLUMN queued_at timestamptz;

UPDATE conversations
SET queued_at = created_at
WHERE queued_at IS NULL;

ALTER TABLE conversations
  ALTER COLUMN queued_at SET NOT NULL,
  ALTER COLUMN queued_at SET DEFAULT now();

CREATE TABLE agent_presence (
  agent_id uuid PRIMARY KEY REFERENCES agents (id),
  tenant_id uuid NOT NULL REFERENCES tenants (id),
  desired_status text NOT NULL CHECK (desired_status IN ('available', 'busy', 'away')),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE agent_connections (
  socket_id text PRIMARY KEY,
  agent_id uuid NOT NULL REFERENCES agents (id),
  tenant_id uuid NOT NULL REFERENCES tenants (id),
  connected_at timestamptz NOT NULL DEFAULT now(),
  last_heartbeat_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX agent_connections_agent ON agent_connections (agent_id, tenant_id);

CREATE TABLE conversation_reads (
  conversation_id uuid NOT NULL REFERENCES conversations (id),
  agent_id uuid NOT NULL REFERENCES agents (id),
  tenant_id uuid NOT NULL REFERENCES tenants (id),
  last_read_message_id uuid NOT NULL REFERENCES messages (id),
  read_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (conversation_id, agent_id)
);

CREATE OR REPLACE FUNCTION enforce_agent_scope()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM agents AS agent
    WHERE agent.id = NEW.agent_id
      AND agent.tenant_id = NEW.tenant_id
  ) THEN
    RAISE EXCEPTION 'agent tenant mismatch';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER agent_presence_scope
  BEFORE INSERT OR UPDATE ON agent_presence
  FOR EACH ROW
  EXECUTE FUNCTION enforce_agent_scope();

CREATE TRIGGER agent_connections_scope
  BEFORE INSERT OR UPDATE ON agent_connections
  FOR EACH ROW
  EXECUTE FUNCTION enforce_agent_scope();

CREATE OR REPLACE FUNCTION enforce_conversation_read()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM messages AS message
    JOIN conversations AS conversation
      ON conversation.id = message.conversation_id
     AND conversation.tenant_id = message.tenant_id
    JOIN agents AS agent
      ON agent.id = NEW.agent_id
     AND agent.tenant_id = NEW.tenant_id
    WHERE message.id = NEW.last_read_message_id
      AND conversation.id = NEW.conversation_id
      AND conversation.tenant_id = NEW.tenant_id
  ) THEN
    RAISE EXCEPTION 'conversation read mismatch';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER conversation_reads_scope
  BEFORE INSERT OR UPDATE ON conversation_reads
  FOR EACH ROW
  EXECUTE FUNCTION enforce_conversation_read();

CREATE OR REPLACE FUNCTION sweep_stale_agent_connections(p_stale_ms integer)
RETURNS TABLE (agent_id uuid, tenant_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  DELETE FROM agent_connections AS connection
  WHERE connection.last_heartbeat_at < now() - (p_stale_ms * interval '1 millisecond')
  RETURNING connection.agent_id, connection.tenant_id;
END;
$$;

ALTER TABLE agent_presence ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_presence FORCE ROW LEVEL SECURITY;
ALTER TABLE agent_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_connections FORCE ROW LEVEL SECURITY;
ALTER TABLE conversation_reads ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversation_reads FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON agent_presence
  USING (tenant_id = app_tenant_id())
  WITH CHECK (tenant_id = app_tenant_id());

CREATE POLICY tenant_isolation ON agent_connections
  USING (tenant_id = app_tenant_id())
  WITH CHECK (tenant_id = app_tenant_id());

CREATE POLICY tenant_isolation ON conversation_reads
  USING (tenant_id = app_tenant_id())
  WITH CHECK (tenant_id = app_tenant_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON
  agent_presence,
  agent_connections,
  conversation_reads
TO webchat_app;

GRANT EXECUTE ON FUNCTION sweep_stale_agent_connections(integer) TO webchat_app;
GRANT EXECUTE ON FUNCTION enforce_agent_scope() TO webchat_app;
GRANT EXECUTE ON FUNCTION enforce_conversation_read() TO webchat_app;
