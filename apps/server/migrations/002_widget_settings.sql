ALTER TABLE sites
  ADD COLUMN primary_color text NOT NULL DEFAULT '#0c7c73',
  ADD COLUMN logo_url text,
  ADD COLUMN welcome_message text NOT NULL DEFAULT 'Olá. Escolha uma fila para começar.',
  ADD COLUMN require_visitor_name boolean NOT NULL DEFAULT false,
  ADD COLUMN accepting_chats boolean NOT NULL DEFAULT true;

ALTER TABLE sites
  ADD CONSTRAINT sites_primary_color_hex CHECK (primary_color ~ '^#[0-9a-fA-F]{6}$'),
  ADD CONSTRAINT sites_welcome_message_len CHECK (char_length(welcome_message) BETWEEN 1 AND 300),
  ADD CONSTRAINT sites_logo_url_https CHECK (logo_url IS NULL OR logo_url ~ '^https://');

ALTER TABLE visitors
  ADD COLUMN display_name text,
  ADD CONSTRAINT visitors_display_name_len CHECK (
    display_name IS NULL OR char_length(display_name) BETWEEN 1 AND 80
  );

DROP FUNCTION lookup_site_by_public_id(text);

CREATE FUNCTION lookup_site_by_public_id(p_public_id text)
RETURNS TABLE (
  id uuid,
  tenant_id uuid,
  public_id text,
  name text,
  allowed_origins text[],
  primary_color text,
  logo_url text,
  welcome_message text,
  require_visitor_name boolean,
  accepting_chats boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    site.id,
    site.tenant_id,
    site.public_id,
    site.name,
    site.allowed_origins,
    site.primary_color,
    site.logo_url,
    site.welcome_message,
    site.require_visitor_name,
    site.accepting_chats
  FROM sites AS site
  WHERE site.public_id = p_public_id
$$;

GRANT EXECUTE ON FUNCTION lookup_site_by_public_id(text) TO webchat_app;
