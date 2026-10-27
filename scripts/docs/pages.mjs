// Hierarquia de importação: Sistema → Módulo → Página. Fonte única para build e validação.
export const SYSTEM = {
  name: 'ViaVoip Webchat',
  description: 'Documentação técnica do ViaVoip Webchat (servidor, widget ChatWeb, console, banco de dados e integrações), conforme o código até a Fase 4.',
};

// [arquivo md relativo a docs/, título, slug]
export const MODULES = [
  { title: 'Visão Geral', slug: 'visao-geral', pages: [
    ['README.md', 'Visão geral e glossário', 'visao-geral'],
    ['STATUS.md', 'Status de implementação e limitações', 'status'] ] },
  { title: 'Arquitetura', slug: 'arquitetura', pages: [
    ['architecture/overview.md', 'Visão geral da arquitetura', 'visao-geral'],
    ['architecture/multi-tenancy.md', 'Multi-tenancy', 'multi-tenancy'],
    ['architecture/websocket.md', 'Servidor WebSocket', 'websocket'],
    ['contracts.md', 'Contratos HTTP e WebSocket', 'contratos'],
    ['decisions.md', 'Decisões de arquitetura', 'decisoes'],
    ['diagrams/README.md', 'Diagramas', 'diagramas'] ] },
  { title: 'Banco de Dados', slug: 'banco-de-dados', pages: [
    ['database/overview.md', 'Visão geral do banco', 'visao-geral'],
    ['database/data-dictionary.md', 'Dicionário de dados', 'dicionario-de-dados'],
    ['database/relationships.md', 'Relacionamentos', 'relacionamentos'] ] },
  { title: 'Widget ChatWeb', slug: 'widget-chatweb', pages: [['modules/widget.md', 'Widget ChatWeb', 'widget']] },
  { title: 'Central do Agente', slug: 'central-do-agente', pages: [['modules/agent.md', 'Central do Agente', 'agente']] },
  { title: 'Chat Interno', slug: 'chat-interno', pages: [['modules/internal-chat.md', 'Chat interno', 'chat-interno']] },
  { title: 'Setores', slug: 'setores', pages: [['modules/sectors.md', 'Setores', 'setores']] },
  { title: 'Anúncios', slug: 'anuncios', pages: [['modules/announcements.md', 'Quadro de anúncios', 'anuncios']] },
  { title: 'Presença e Atividades', slug: 'presenca-e-atividades', pages: [
    ['modules/presence.md', 'Presença', 'presenca'],
    ['modules/activities.md', 'Atividades e alocações', 'atividades'] ] },
  { title: 'Central do Supervisor', slug: 'central-do-supervisor', pages: [['modules/supervisor.md', 'Central do Supervisor', 'supervisor']] },
  { title: 'Integrações', slug: 'integracoes', pages: [['architecture/integration-sm.md', 'Integração com o SM', 'sm']] },
  { title: 'Implantação e Operação', slug: 'implantacao-e-operacao', pages: [
    ['deployment/environments.md', 'Ambientes', 'ambientes'],
    ['deployment/local-setup.md', 'Setup local', 'setup-local'],
    ['docs-helper/VALIDATION.md', 'Validação', 'validacao'],
    ['MAINTENANCE.md', 'Manutenção da documentação', 'manutencao'] ] },
];

export const DIAGRAM_TITLES = {
  'context': 'Contexto do sistema (C4 nível 1)',
  'containers': 'Containers (C4 nível 2)',
  'backend-components': 'Componentes do backend',
  'external-chat-sequence': 'Sequência do atendimento externo',
  'internal-chat-sequence': 'Sequência do chat interno',
  'database-erd': 'DER geral',
  'database-erd-identity': 'DER — identidade e tenants',
  'database-erd-attendance': 'DER — atendimentos',
  'database-erd-internal': 'DER — chat interno',
  'database-erd-sectors': 'DER — setores e anúncios',
  'database-erd-presence': 'DER — presença e atividades',
  'attendance-states': 'Estados do atendimento',
  'presence-states': 'Estados de presença',
  'activity-states': 'Estados de atividade/alocação',
  'infrastructure': 'Infraestrutura',
};
export const pageHtmlPath = (mod, page) => `html/${mod.slug}/${page[2]}.html`;
