INSERT INTO tenants (id, slug, name) VALUES
  ('11111111-1111-4111-8111-111111111111', 'tenant-a', 'Tenant A'),
  ('22222222-2222-4222-8222-222222222222', 'tenant-b', 'Tenant B')
ON CONFLICT (id) DO NOTHING;

UPDATE tenants SET max_concurrent_assignments = 3;

INSERT INTO sites (id, tenant_id, public_id, name, allowed_origins) VALUES
  (
    'aaaaaaaa-1111-4111-8111-aaaaaaaaaaa1',
    '11111111-1111-4111-8111-111111111111',
    'site_a',
    'Site A',
    ARRAY['http://localhost:8090', 'http://127.0.0.1:8090']::text[]
  ),
  (
    'bbbbbbbb-2222-4222-8222-bbbbbbbbbbb1',
    '22222222-2222-4222-8222-222222222222',
    'site_b',
    'Site B',
    ARRAY['http://localhost:8090', 'http://127.0.0.1:8090']::text[]
  )
ON CONFLICT (id) DO NOTHING;

INSERT INTO queues (id, tenant_id, name) VALUES
  ('aaaaaaaa-1111-4111-8111-aaaaaaaaaaa2', '11111111-1111-4111-8111-111111111111', 'Suporte'),
  ('aaaaaaaa-1111-4111-8111-aaaaaaaaaaa3', '11111111-1111-4111-8111-111111111111', 'Vendas'),
  ('bbbbbbbb-2222-4222-8222-bbbbbbbbbbb2', '22222222-2222-4222-8222-222222222222', 'Suporte'),
  ('bbbbbbbb-2222-4222-8222-bbbbbbbbbbb3', '22222222-2222-4222-8222-222222222222', 'Vendas')
ON CONFLICT (id) DO NOTHING;

INSERT INTO site_queues (site_id, queue_id, tenant_id) VALUES
  ('aaaaaaaa-1111-4111-8111-aaaaaaaaaaa1', 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaa2', '11111111-1111-4111-8111-111111111111'),
  ('aaaaaaaa-1111-4111-8111-aaaaaaaaaaa1', 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaa3', '11111111-1111-4111-8111-111111111111'),
  ('bbbbbbbb-2222-4222-8222-bbbbbbbbbbb1', 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbb2', '22222222-2222-4222-8222-222222222222'),
  ('bbbbbbbb-2222-4222-8222-bbbbbbbbbbb1', 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbb3', '22222222-2222-4222-8222-222222222222')
ON CONFLICT (site_id, queue_id) DO NOTHING;

INSERT INTO agents (id, tenant_id, email, name, password_hash, role) VALUES
  ('aaaaaaaa-1111-4111-8111-aaaaaaaaaaa4', '11111111-1111-4111-8111-111111111111', 'ana@tenant-a.local', 'Ana Lima', '__DEMO_PASSWORD_HASH__', 'agent'),
  ('aaaaaaaa-1111-4111-8111-aaaaaaaaaaa5', '11111111-1111-4111-8111-111111111111', 'bruno@tenant-a.local', 'Bruno Costa', '__DEMO_PASSWORD_HASH__', 'agent'),
  ('aaaaaaaa-1111-4111-8111-aaaaaaaaaaa6', '11111111-1111-4111-8111-111111111111', 'sofia@tenant-a.local', 'Sofia Nunes', '__DEMO_PASSWORD_HASH__', 'supervisor'),
  ('bbbbbbbb-2222-4222-8222-bbbbbbbbbbb4', '22222222-2222-4222-8222-222222222222', 'carla@tenant-b.local', 'Carla Dias', '__DEMO_PASSWORD_HASH__', 'agent'),
  ('aaaaaaaa-1111-4111-8111-aaaaaaaaaa12', '11111111-1111-4111-8111-111111111111', 'diana@tenant-a.local', 'Diana Melo', '__DEMO_PASSWORD_HASH__', 'agent'),
  ('aaaaaaaa-1111-4111-8111-aaaaaaaaaa13', '11111111-1111-4111-8111-111111111111', 'eduardo@tenant-a.local', 'Eduardo Pires', '__DEMO_PASSWORD_HASH__', 'agent'),
  ('aaaaaaaa-1111-4111-8111-aaaaaaaaaa14', '11111111-1111-4111-8111-111111111111', 'helena@tenant-a.local', 'Helena Prado', '__DEMO_PASSWORD_HASH__', 'supervisor'),
  ('aaaaaaaa-1111-4111-8111-aaaaaaaaaa15', '11111111-1111-4111-8111-111111111111', 'otavio@tenant-a.local', 'Otávio Ramos', '__DEMO_PASSWORD_HASH__', 'admin'),
  ('bbbbbbbb-2222-4222-8222-bbbbbbbbbb13', '22222222-2222-4222-8222-222222222222', 'renata@tenant-b.local', 'Renata Luz', '__DEMO_PASSWORD_HASH__', 'supervisor'),
  ('bbbbbbbb-2222-4222-8222-bbbbbbbbbb14', '22222222-2222-4222-8222-222222222222', 'tiago@tenant-b.local', 'Tiago Neri', '__DEMO_PASSWORD_HASH__', 'agent')
ON CONFLICT (id) DO NOTHING;

UPDATE agents
SET can_change_own_activity = true
WHERE id = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaa12';

INSERT INTO agent_queues (agent_id, queue_id, tenant_id) VALUES
  ('aaaaaaaa-1111-4111-8111-aaaaaaaaaaa4', 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaa2', '11111111-1111-4111-8111-111111111111'),
  ('aaaaaaaa-1111-4111-8111-aaaaaaaaaaa4', 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaa3', '11111111-1111-4111-8111-111111111111'),
  ('aaaaaaaa-1111-4111-8111-aaaaaaaaaaa5', 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaa2', '11111111-1111-4111-8111-111111111111'),
  ('bbbbbbbb-2222-4222-8222-bbbbbbbbbbb4', 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbb2', '22222222-2222-4222-8222-222222222222'),
  ('bbbbbbbb-2222-4222-8222-bbbbbbbbbbb4', 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbb3', '22222222-2222-4222-8222-222222222222'),
  ('aaaaaaaa-1111-4111-8111-aaaaaaaaaa12', 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaa3', '11111111-1111-4111-8111-111111111111'),
  ('aaaaaaaa-1111-4111-8111-aaaaaaaaaa13', 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaa2', '11111111-1111-4111-8111-111111111111'),
  ('bbbbbbbb-2222-4222-8222-bbbbbbbbbb14', 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbb2', '22222222-2222-4222-8222-222222222222'),
  ('bbbbbbbb-2222-4222-8222-bbbbbbbbbb14', 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbb3', '22222222-2222-4222-8222-222222222222')
ON CONFLICT (agent_id, queue_id) DO NOTHING;

INSERT INTO dispositions (id, tenant_id, name) VALUES
  ('aaaaaaaa-1111-4111-8111-aaaaaaaaaaa7', '11111111-1111-4111-8111-111111111111', 'Resolvido'),
  ('aaaaaaaa-1111-4111-8111-aaaaaaaaaaa8', '11111111-1111-4111-8111-111111111111', 'Sem solução'),
  ('aaaaaaaa-1111-4111-8111-aaaaaaaaaa10', '11111111-1111-4111-8111-111111111111', 'Atendimento interrompido'),
  ('aaaaaaaa-1111-4111-8111-aaaaaaaaaa11', '11111111-1111-4111-8111-111111111111', 'Outro'),
  ('bbbbbbbb-2222-4222-8222-bbbbbbbbbbb7', '22222222-2222-4222-8222-222222222222', 'Resolvido'),
  ('bbbbbbbb-2222-4222-8222-bbbbbbbbbb10', '22222222-2222-4222-8222-222222222222', 'Sem solução'),
  ('bbbbbbbb-2222-4222-8222-bbbbbbbbbb11', '22222222-2222-4222-8222-222222222222', 'Atendimento interrompido'),
  ('bbbbbbbb-2222-4222-8222-bbbbbbbbbb12', '22222222-2222-4222-8222-222222222222', 'Outro')
ON CONFLICT (id) DO NOTHING;

INSERT INTO survey_definitions (id, tenant_id, prompt, scale, comment_enabled, active) VALUES
  (
    'aaaaaaaa-1111-4111-8111-aaaaaaaaaaa9',
    '11111111-1111-4111-8111-111111111111',
    'Como você avalia este atendimento?',
    5,
    true,
    true
  ),
  (
    'bbbbbbbb-2222-4222-8222-bbbbbbbbbbb9',
    '22222222-2222-4222-8222-222222222222',
    'Como você avalia este atendimento?',
    5,
    true,
    true
  )
ON CONFLICT (id) DO NOTHING;

UPDATE sites
SET primary_color = '#0c7c73',
    welcome_message = 'Olá, bem-vindo ao atendimento do Site A.',
    require_visitor_name = false,
    accepting_chats = true
WHERE public_id = 'site_a';

UPDATE sites
SET primary_color = '#1d4e89',
    welcome_message = 'Olá, bem-vindo ao atendimento do Site B.',
    require_visitor_name = false,
    accepting_chats = true
WHERE public_id = 'site_b';

INSERT INTO sectors (id, tenant_id, name, description) VALUES
  ('aaaaaaaa-1111-4111-8111-aaaaaaaaaa16', '11111111-1111-4111-8111-111111111111', 'Suporte Técnico', 'Atendimento técnico interno'),
  ('aaaaaaaa-1111-4111-8111-aaaaaaaaaa17', '11111111-1111-4111-8111-111111111111', 'Comercial', 'Vendas e propostas'),
  ('bbbbbbbb-2222-4222-8222-bbbbbbbbbb15', '22222222-2222-4222-8222-222222222222', 'Suporte Técnico', 'Atendimento técnico interno'),
  ('bbbbbbbb-2222-4222-8222-bbbbbbbbbb16', '22222222-2222-4222-8222-222222222222', 'Financeiro', 'Cobrança e faturamento')
ON CONFLICT (id) DO NOTHING;

INSERT INTO sector_supervisors (sector_id, agent_id, tenant_id) VALUES
  ('aaaaaaaa-1111-4111-8111-aaaaaaaaaa16', 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaa6', '11111111-1111-4111-8111-111111111111'),
  ('aaaaaaaa-1111-4111-8111-aaaaaaaaaa17', 'aaaaaaaa-1111-4111-8111-aaaaaaaaaa14', '11111111-1111-4111-8111-111111111111'),
  ('bbbbbbbb-2222-4222-8222-bbbbbbbbbb15', 'bbbbbbbb-2222-4222-8222-bbbbbbbbbb13', '22222222-2222-4222-8222-222222222222'),
  ('bbbbbbbb-2222-4222-8222-bbbbbbbbbb16', 'bbbbbbbb-2222-4222-8222-bbbbbbbbbb13', '22222222-2222-4222-8222-222222222222')
ON CONFLICT (sector_id, agent_id) DO NOTHING;

INSERT INTO sector_members (sector_id, agent_id, tenant_id) VALUES
  ('aaaaaaaa-1111-4111-8111-aaaaaaaaaa16', 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaa4', '11111111-1111-4111-8111-111111111111'),
  ('aaaaaaaa-1111-4111-8111-aaaaaaaaaa16', 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaa5', '11111111-1111-4111-8111-111111111111'),
  ('aaaaaaaa-1111-4111-8111-aaaaaaaaaa16', 'aaaaaaaa-1111-4111-8111-aaaaaaaaaa13', '11111111-1111-4111-8111-111111111111'),
  ('aaaaaaaa-1111-4111-8111-aaaaaaaaaa17', 'aaaaaaaa-1111-4111-8111-aaaaaaaaaa12', '11111111-1111-4111-8111-111111111111'),
  ('aaaaaaaa-1111-4111-8111-aaaaaaaaaa17', 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaa4', '11111111-1111-4111-8111-111111111111'),
  ('bbbbbbbb-2222-4222-8222-bbbbbbbbbb15', 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbb4', '22222222-2222-4222-8222-222222222222'),
  ('bbbbbbbb-2222-4222-8222-bbbbbbbbbb15', 'bbbbbbbb-2222-4222-8222-bbbbbbbbbb14', '22222222-2222-4222-8222-222222222222'),
  ('bbbbbbbb-2222-4222-8222-bbbbbbbbbb16', 'bbbbbbbb-2222-4222-8222-bbbbbbbbbb14', '22222222-2222-4222-8222-222222222222')
ON CONFLICT (sector_id, agent_id) DO NOTHING;

INSERT INTO internal_conversations (id, tenant_id, kind, sector_id, pair_key) VALUES
  ('aaaaaaaa-1111-4111-8111-aaaaaaaaaa23', '11111111-1111-4111-8111-111111111111', 'group', 'aaaaaaaa-1111-4111-8111-aaaaaaaaaa16', NULL),
  ('aaaaaaaa-1111-4111-8111-aaaaaaaaaa24', '11111111-1111-4111-8111-111111111111', 'group', 'aaaaaaaa-1111-4111-8111-aaaaaaaaaa17', NULL),
  ('bbbbbbbb-2222-4222-8222-bbbbbbbbbb18', '22222222-2222-4222-8222-222222222222', 'group', 'bbbbbbbb-2222-4222-8222-bbbbbbbbbb15', NULL),
  ('bbbbbbbb-2222-4222-8222-bbbbbbbbbb19', '22222222-2222-4222-8222-222222222222', 'group', 'bbbbbbbb-2222-4222-8222-bbbbbbbbbb16', NULL),
  (
    'aaaaaaaa-1111-4111-8111-aaaaaaaaaa22',
    '11111111-1111-4111-8111-111111111111',
    'direct',
    NULL,
    'aaaaaaaa-1111-4111-8111-aaaaaaaaaaa4:aaaaaaaa-1111-4111-8111-aaaaaaaaaaa6'
  )
ON CONFLICT (id) DO NOTHING;

INSERT INTO internal_participants (conversation_id, agent_id, tenant_id) VALUES
  ('aaaaaaaa-1111-4111-8111-aaaaaaaaaa23', 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaa6', '11111111-1111-4111-8111-111111111111'),
  ('aaaaaaaa-1111-4111-8111-aaaaaaaaaa23', 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaa4', '11111111-1111-4111-8111-111111111111'),
  ('aaaaaaaa-1111-4111-8111-aaaaaaaaaa23', 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaa5', '11111111-1111-4111-8111-111111111111'),
  ('aaaaaaaa-1111-4111-8111-aaaaaaaaaa23', 'aaaaaaaa-1111-4111-8111-aaaaaaaaaa13', '11111111-1111-4111-8111-111111111111'),
  ('aaaaaaaa-1111-4111-8111-aaaaaaaaaa24', 'aaaaaaaa-1111-4111-8111-aaaaaaaaaa14', '11111111-1111-4111-8111-111111111111'),
  ('aaaaaaaa-1111-4111-8111-aaaaaaaaaa24', 'aaaaaaaa-1111-4111-8111-aaaaaaaaaa12', '11111111-1111-4111-8111-111111111111'),
  ('aaaaaaaa-1111-4111-8111-aaaaaaaaaa24', 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaa4', '11111111-1111-4111-8111-111111111111'),
  ('bbbbbbbb-2222-4222-8222-bbbbbbbbbb18', 'bbbbbbbb-2222-4222-8222-bbbbbbbbbb13', '22222222-2222-4222-8222-222222222222'),
  ('bbbbbbbb-2222-4222-8222-bbbbbbbbbb18', 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbb4', '22222222-2222-4222-8222-222222222222'),
  ('bbbbbbbb-2222-4222-8222-bbbbbbbbbb18', 'bbbbbbbb-2222-4222-8222-bbbbbbbbbb14', '22222222-2222-4222-8222-222222222222'),
  ('bbbbbbbb-2222-4222-8222-bbbbbbbbbb19', 'bbbbbbbb-2222-4222-8222-bbbbbbbbbb13', '22222222-2222-4222-8222-222222222222'),
  ('bbbbbbbb-2222-4222-8222-bbbbbbbbbb19', 'bbbbbbbb-2222-4222-8222-bbbbbbbbbb14', '22222222-2222-4222-8222-222222222222'),
  ('aaaaaaaa-1111-4111-8111-aaaaaaaaaa22', 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaa4', '11111111-1111-4111-8111-111111111111'),
  ('aaaaaaaa-1111-4111-8111-aaaaaaaaaa22', 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaa6', '11111111-1111-4111-8111-111111111111')
ON CONFLICT (conversation_id, agent_id) DO NOTHING;

INSERT INTO internal_messages (id, tenant_id, conversation_id, sender_id, request_id, body) VALUES
  (
    'aaaaaaaa-1111-4111-8111-aaaaaaaaaa28',
    '11111111-1111-4111-8111-111111111111',
    'aaaaaaaa-1111-4111-8111-aaaaaaaaaa22',
    'aaaaaaaa-1111-4111-8111-aaaaaaaaaaa4',
    'aaaaaaaa-1111-4111-8111-aaaaaaaaaa26',
    'Bom dia, Sofia.'
  ),
  (
    'aaaaaaaa-1111-4111-8111-aaaaaaaaaa29',
    '11111111-1111-4111-8111-111111111111',
    'aaaaaaaa-1111-4111-8111-aaaaaaaaaa23',
    'aaaaaaaa-1111-4111-8111-aaaaaaaaaaa6',
    'aaaaaaaa-1111-4111-8111-aaaaaaaaaa27',
    'Equipe de suporte, bom turno.'
  )
ON CONFLICT (id) DO NOTHING;

INSERT INTO activity_types (id, tenant_id, name) VALUES
  ('aaaaaaaa-1111-4111-8111-aaaaaaaaaa18', '11111111-1111-4111-8111-111111111111', 'Atendimento'),
  ('aaaaaaaa-1111-4111-8111-aaaaaaaaaa19', '11111111-1111-4111-8111-111111111111', 'Treinamento'),
  ('bbbbbbbb-2222-4222-8222-bbbbbbbbbb17', '22222222-2222-4222-8222-222222222222', 'Atendimento')
ON CONFLICT (id) DO NOTHING;

INSERT INTO activity_assignments (
  id, tenant_id, agent_id, activity_type_id, assigned_by, status
) VALUES (
  'aaaaaaaa-1111-4111-8111-aaaaaaaaaa25',
  '11111111-1111-4111-8111-111111111111',
  'aaaaaaaa-1111-4111-8111-aaaaaaaaaa13',
  'aaaaaaaa-1111-4111-8111-aaaaaaaaaa19',
  'aaaaaaaa-1111-4111-8111-aaaaaaaaaaa6',
  'active'
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO announcements (
  id, tenant_id, author_id, title, body, pinned, audience
) VALUES
  (
    'aaaaaaaa-1111-4111-8111-aaaaaaaaaa20',
    '11111111-1111-4111-8111-111111111111',
    'aaaaaaaa-1111-4111-8111-aaaaaaaaaa15',
    'Bem-vindos ao chat interno',
    'O quadro de anúncios passa a ser o canal oficial da empresa.',
    true,
    'tenant'
  ),
  (
    'aaaaaaaa-1111-4111-8111-aaaaaaaaaa21',
    '11111111-1111-4111-8111-111111111111',
    'aaaaaaaa-1111-4111-8111-aaaaaaaaaaa6',
    'Plantão do suporte',
    'O plantão desta semana fica com a equipe técnica.',
    false,
    'sectors'
  )
ON CONFLICT (id) DO NOTHING;

INSERT INTO announcement_sectors (announcement_id, sector_id, tenant_id) VALUES
  (
    'aaaaaaaa-1111-4111-8111-aaaaaaaaaa21',
    'aaaaaaaa-1111-4111-8111-aaaaaaaaaa16',
    '11111111-1111-4111-8111-111111111111'
  )
ON CONFLICT (announcement_id, sector_id) DO NOTHING;

INSERT INTO announcement_revisions (tenant_id, announcement_id, editor_id, title, body)
SELECT tenant_id, id, author_id, title, body
FROM announcements
WHERE id IN (
  'aaaaaaaa-1111-4111-8111-aaaaaaaaaa20',
  'aaaaaaaa-1111-4111-8111-aaaaaaaaaa21'
)
AND NOT EXISTS (
  SELECT 1 FROM announcement_revisions AS revision
  WHERE revision.announcement_id = announcements.id
);

INSERT INTO agent_presence (agent_id, tenant_id, desired_status) VALUES
  ('aaaaaaaa-1111-4111-8111-aaaaaaaaaa13', '11111111-1111-4111-8111-111111111111', 'away')
ON CONFLICT (agent_id) DO UPDATE SET desired_status = 'away';
