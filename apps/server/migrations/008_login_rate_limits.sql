CREATE TABLE login_rate_limits (
  key_hash text PRIMARY KEY CHECK (key_hash ~ '^[0-9a-f]{64}$'),
  window_started_at timestamptz NOT NULL,
  attempts integer NOT NULL CHECK (attempts > 0)
);

CREATE INDEX login_rate_limits_window ON login_rate_limits (window_started_at);

GRANT SELECT, INSERT, UPDATE, DELETE ON login_rate_limits TO webchat_app;
