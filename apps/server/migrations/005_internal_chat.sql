CREATE TABLE internal_conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants (id),
  kind text NOT NULL CHECK (kind IN ('direct', 'group')),
  sector_id uuid REFERENCES sectors (id),
  pair_key text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (kind = 'group' AND sector_id IS NOT NULL AND pair_key IS NULL)
    OR (kind = 'direct' AND sector_id IS NULL AND pair_key IS NOT NULL)
  )
);

CREATE UNIQUE INDEX internal_conversations_one_group
  ON internal_conversations (tenant_id, sector_id)
  WHERE kind = 'group';

CREATE UNIQUE INDEX internal_conversations_one_direct
  ON internal_conversations (tenant_id, pair_key)
  WHERE kind = 'direct';

CREATE TABLE internal_participants (
  conversation_id uuid NOT NULL REFERENCES internal_conversations (id),
  agent_id uuid NOT NULL REFERENCES agents (id),
  tenant_id uuid NOT NULL REFERENCES tenants (id),
  joined_at timestamptz NOT NULL DEFAULT now(),
  removed_at timestamptz,
  PRIMARY KEY (conversation_id, agent_id)
);

CREATE INDEX internal_participants_agent ON internal_participants (tenant_id, agent_id);

CREATE TABLE internal_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants (id),
  conversation_id uuid NOT NULL REFERENCES internal_conversations (id),
  sender_id uuid NOT NULL REFERENCES agents (id),
  request_id uuid NOT NULL,
  body text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 4000),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (conversation_id, request_id)
);

CREATE INDEX internal_messages_order ON internal_messages (conversation_id, created_at, id);

CREATE TABLE internal_reads (
  conversation_id uuid NOT NULL REFERENCES internal_conversations (id),
  agent_id uuid NOT NULL REFERENCES agents (id),
  tenant_id uuid NOT NULL REFERENCES tenants (id),
  last_read_message_id uuid NOT NULL REFERENCES internal_messages (id),
  read_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (conversation_id, agent_id)
);

CREATE OR REPLACE FUNCTION enforce_internal_conversation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.kind = 'group' AND NOT EXISTS (
    SELECT 1 FROM sectors AS sector
    WHERE sector.id = NEW.sector_id AND sector.tenant_id = NEW.tenant_id
  ) THEN
    RAISE EXCEPTION 'internal conversation tenant mismatch';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER internal_conversations_scope
  BEFORE INSERT OR UPDATE ON internal_conversations
  FOR EACH ROW
  EXECUTE FUNCTION enforce_internal_conversation();

CREATE OR REPLACE FUNCTION enforce_internal_participant()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM internal_conversations AS conversation
    JOIN agents AS agent ON agent.tenant_id = conversation.tenant_id
    WHERE conversation.id = NEW.conversation_id
      AND conversation.tenant_id = NEW.tenant_id
      AND agent.id = NEW.agent_id
  ) THEN
    RAISE EXCEPTION 'internal participant tenant mismatch';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER internal_participants_scope
  BEFORE INSERT OR UPDATE ON internal_participants
  FOR EACH ROW
  EXECUTE FUNCTION enforce_internal_participant();

CREATE OR REPLACE FUNCTION enforce_internal_message()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM internal_conversations AS conversation
    JOIN agents AS agent ON agent.tenant_id = conversation.tenant_id
    WHERE conversation.id = NEW.conversation_id
      AND conversation.tenant_id = NEW.tenant_id
      AND agent.id = NEW.sender_id
  ) THEN
    RAISE EXCEPTION 'internal message tenant mismatch';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER internal_messages_scope
  BEFORE INSERT OR UPDATE ON internal_messages
  FOR EACH ROW
  EXECUTE FUNCTION enforce_internal_message();

CREATE TRIGGER internal_reads_agent
  BEFORE INSERT OR UPDATE ON internal_reads
  FOR EACH ROW
  EXECUTE FUNCTION enforce_agent_scope();

ALTER TABLE internal_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE internal_conversations FORCE ROW LEVEL SECURITY;
ALTER TABLE internal_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE internal_participants FORCE ROW LEVEL SECURITY;
ALTER TABLE internal_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE internal_messages FORCE ROW LEVEL SECURITY;
ALTER TABLE internal_reads ENABLE ROW LEVEL SECURITY;
ALTER TABLE internal_reads FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON internal_conversations
  USING (tenant_id = app_tenant_id())
  WITH CHECK (tenant_id = app_tenant_id());

CREATE POLICY tenant_isolation ON internal_participants
  USING (tenant_id = app_tenant_id())
  WITH CHECK (tenant_id = app_tenant_id());

CREATE POLICY tenant_isolation ON internal_messages
  USING (tenant_id = app_tenant_id())
  WITH CHECK (tenant_id = app_tenant_id());

CREATE POLICY tenant_isolation ON internal_reads
  USING (tenant_id = app_tenant_id())
  WITH CHECK (tenant_id = app_tenant_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON
  internal_conversations,
  internal_participants,
  internal_messages,
  internal_reads
TO webchat_app;

GRANT EXECUTE ON FUNCTION enforce_internal_conversation() TO webchat_app;
GRANT EXECUTE ON FUNCTION enforce_internal_participant() TO webchat_app;
GRANT EXECUTE ON FUNCTION enforce_internal_message() TO webchat_app;
