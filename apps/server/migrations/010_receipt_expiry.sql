ALTER TABLE company_command_receipts
  ADD COLUMN expires_at timestamptz NOT NULL DEFAULT (now() + interval '24 hours');

ALTER TABLE company_command_receipts
  ADD CONSTRAINT company_command_receipts_expiry CHECK (expires_at >= created_at);

CREATE INDEX company_command_receipts_expiry ON company_command_receipts (tenant_id, actor_id, expires_at);

GRANT DELETE ON company_command_receipts TO webchat_app;
