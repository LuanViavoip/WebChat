CREATE TABLE announcements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants (id),
  author_id uuid NOT NULL REFERENCES agents (id),
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 160),
  body text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 4000),
  pinned boolean NOT NULL DEFAULT false,
  audience text NOT NULL CHECK (audience IN ('tenant', 'sectors')),
  published_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  archived_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX announcements_tenant_published ON announcements (tenant_id, published_at DESC);

CREATE TABLE announcement_sectors (
  announcement_id uuid NOT NULL REFERENCES announcements (id),
  sector_id uuid NOT NULL REFERENCES sectors (id),
  tenant_id uuid NOT NULL REFERENCES tenants (id),
  PRIMARY KEY (announcement_id, sector_id)
);

CREATE TABLE announcement_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants (id),
  announcement_id uuid NOT NULL REFERENCES announcements (id),
  editor_id uuid NOT NULL REFERENCES agents (id),
  title text NOT NULL,
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE announcement_reads (
  announcement_id uuid NOT NULL REFERENCES announcements (id),
  agent_id uuid NOT NULL REFERENCES agents (id),
  tenant_id uuid NOT NULL REFERENCES tenants (id),
  read_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (announcement_id, agent_id)
);

CREATE OR REPLACE FUNCTION enforce_announcement_author()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM agents AS agent
    WHERE agent.id = NEW.author_id
      AND agent.tenant_id = NEW.tenant_id
  ) THEN
    RAISE EXCEPTION 'announcement author tenant mismatch';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER announcement_author_scope
  BEFORE INSERT OR UPDATE ON announcements
  FOR EACH ROW
  EXECUTE FUNCTION enforce_announcement_author();

CREATE OR REPLACE FUNCTION enforce_announcement_sector()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM announcements AS announcement
    JOIN sectors AS sector ON sector.tenant_id = announcement.tenant_id
    WHERE announcement.id = NEW.announcement_id
      AND announcement.tenant_id = NEW.tenant_id
      AND sector.id = NEW.sector_id
  ) THEN
    RAISE EXCEPTION 'announcement sector tenant mismatch';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER announcement_sectors_scope
  BEFORE INSERT OR UPDATE ON announcement_sectors
  FOR EACH ROW
  EXECUTE FUNCTION enforce_announcement_sector();

CREATE OR REPLACE FUNCTION enforce_announcement_revision()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM announcements AS announcement
    JOIN agents AS agent ON agent.tenant_id = announcement.tenant_id
    WHERE announcement.id = NEW.announcement_id
      AND announcement.tenant_id = NEW.tenant_id
      AND agent.id = NEW.editor_id
  ) THEN
    RAISE EXCEPTION 'announcement revision tenant mismatch';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER announcement_revisions_scope
  BEFORE INSERT OR UPDATE ON announcement_revisions
  FOR EACH ROW
  EXECUTE FUNCTION enforce_announcement_revision();

CREATE TRIGGER announcement_reads_agent
  BEFORE INSERT OR UPDATE ON announcement_reads
  FOR EACH ROW
  EXECUTE FUNCTION enforce_agent_scope();

ALTER TABLE announcements ENABLE ROW LEVEL SECURITY;
ALTER TABLE announcements FORCE ROW LEVEL SECURITY;
ALTER TABLE announcement_sectors ENABLE ROW LEVEL SECURITY;
ALTER TABLE announcement_sectors FORCE ROW LEVEL SECURITY;
ALTER TABLE announcement_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE announcement_revisions FORCE ROW LEVEL SECURITY;
ALTER TABLE announcement_reads ENABLE ROW LEVEL SECURITY;
ALTER TABLE announcement_reads FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON announcements
  USING (tenant_id = app_tenant_id())
  WITH CHECK (tenant_id = app_tenant_id());

CREATE POLICY tenant_isolation ON announcement_sectors
  USING (tenant_id = app_tenant_id())
  WITH CHECK (tenant_id = app_tenant_id());

CREATE POLICY tenant_isolation ON announcement_revisions
  USING (tenant_id = app_tenant_id())
  WITH CHECK (tenant_id = app_tenant_id());

CREATE POLICY tenant_isolation ON announcement_reads
  USING (tenant_id = app_tenant_id())
  WITH CHECK (tenant_id = app_tenant_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON
  announcements,
  announcement_sectors,
  announcement_revisions,
  announcement_reads
TO webchat_app;

GRANT EXECUTE ON FUNCTION enforce_announcement_author() TO webchat_app;
GRANT EXECUTE ON FUNCTION enforce_announcement_sector() TO webchat_app;
GRANT EXECUTE ON FUNCTION enforce_announcement_revision() TO webchat_app;
