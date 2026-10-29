// Hierarquia de importação: Sistema → Módulo → Página. Fonte única para build e validação.
export const SYSTEM = {
  name: 'ViaVoip Webchat',
  description: 'Documentação técnica do ViaVoip Webchat (servidor, widget ChatWeb, console, banco de dados e integrações), conforme o código até a Fase 5.5 (commit 3d9e2cf): console redesenhado, widget corrigido, administração e qualidade.',
};

// [arquivo md relativo a docs/, título, slug]
export const MODULES = [
  { title: 'Visão Geral', slug: 'visao-geral', pages: [
    ['README.md', 'Visão geral e glossário', 'visao-geral'],
    ['STATUS.md', 'Status de implementação e limitações', 'status'],
    ['fase-5.5/RELATORIO.md', 'Fase 5.5: relatório de entrega', 'fase-5-5'] ] },
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
  { title: 'Widget ChatWeb', slug: 'widget-chatweb', pages: [
    ['modules/widget.md', 'Widget ChatWeb', 'widget'],
    ['modules/widget-geometria.md', 'Geometria e correção do recorte', 'geometria'] ] },
  { title: 'Interface do Console', slug: 'interface-do-console', pages: [
    ['console/navegacao-e-papeis.md', 'Navegação por papel, conectividade e presença', 'navegacao-e-papeis'],
    ['fase-5.5/DESIGN_SYSTEM.md', 'Design system ViaVoip', 'design-system'] ] },
  { title: 'Central do Agente', slug: 'central-do-agente', pages: [['modules/agent.md', 'Central do Agente', 'agente']] },
  { title: 'Chat Interno', slug: 'chat-interno', pages: [['modules/internal-chat.md', 'Chat interno', 'chat-interno']] },
  { title: 'Setores', slug: 'setores', pages: [['modules/sectors.md', 'Setores', 'setores']] },
  { title: 'Anúncios', slug: 'anuncios', pages: [['modules/announcements.md', 'Quadro de anúncios', 'anuncios']] },
  { title: 'Presença e Atividades', slug: 'presenca-e-atividades', pages: [
    ['modules/presence.md', 'Presença', 'presenca'],
    ['modules/activities.md', 'Atividades e alocações', 'atividades'] ] },
  { title: 'Gestão Administrativa', slug: 'gestao-administrativa', pages: [
    ['gestao-administrativa/papeis-e-permissoes.md', 'Papéis e permissões', 'papeis-e-permissoes'],
    ['gestao-administrativa/configuracao-por-empresa.md', 'Configuração por empresa', 'configuracao-por-empresa'],
    ['gestao-administrativa/painel-de-administracao.md', 'Painel de administração', 'painel-de-administracao'],
    ['gestao-administrativa/comandos-idempotentes.md', 'Comandos idempotentes', 'comandos-idempotentes'],
    ['gestao-administrativa/auditoria.md', 'Auditoria', 'auditoria'],
    ['gestao-administrativa/revogacao-de-sessao.md', 'Revogação de sessão', 'revogacao-de-sessao'] ] },
  { title: 'Qualidade Operacional', slug: 'qualidade-operacional', pages: [
    ['qualidade-operacional/politica-de-sla.md', 'Política de SLA', 'politica-de-sla'],
    ['qualidade-operacional/relatorio-de-qualidade.md', 'Relatório de qualidade', 'relatorio-de-qualidade'] ] },
  { title: 'Central do Supervisor', slug: 'central-do-supervisor', pages: [['modules/supervisor.md', 'Central do Supervisor', 'supervisor']] },
  { title: 'Integrações', slug: 'integracoes', pages: [['architecture/integration-sm.md', 'Integração com o SM', 'sm']] },
  { title: 'Demonstração e Testes', slug: 'demonstracao-e-testes', pages: [
    ['fase-5.5/DEMO_SITE_LOCAL.md', 'Demo local no site institucional', 'demo-site-local'],
    ['fase-5.5/testes-visuais.md', 'Testes visuais', 'testes-visuais'] ] },
  { title: 'Implantação e Operação', slug: 'implantacao-e-operacao', pages: [
    ['deployment/environments.md', 'Ambientes', 'ambientes'],
    ['deployment/migrations-009-011.md', 'Migrations 009 a 011', 'migrations-009-011'],
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
