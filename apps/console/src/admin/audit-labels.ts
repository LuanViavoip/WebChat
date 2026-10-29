import type { AuditAction, KnownAuditAction } from '@viavoip/protocol';

export const auditActionLabels: Record<KnownAuditAction, string> = {
  'conversation.watch': 'Conversa acompanhada pela supervisão',
  'sector.save': 'Setor salvo',
  'sector.member_added': 'Membro incluído no setor',
  'sector.member_removed': 'Membro removido do setor',
  'announcement.publish': 'Anúncio publicado',
  'announcement.update': 'Anúncio atualizado',
  'announcement.archive': 'Anúncio arquivado',
  'activity.type_save': 'Tipo de atividade salvo',
  'activity.assign': 'Atividade alocada',
  'activity.finish': 'Atividade encerrada',
  'agent.create': 'Usuário criado',
  'agent.suspend': 'Usuário suspenso',
  'agent.reactivate': 'Usuário reativado',
  'agent.role_change': 'Papel alterado',
  'agent.queues_replace': 'Filas do usuário alteradas',
  'agent.activity_authority': 'Autoridade de atividade alterada',
  'agent.credential_reset': 'Senha redefinida',
  'agent.sessions_revoke': 'Sessões revogadas',
  'queue.create': 'Fila criada',
  'queue.rename': 'Fila renomeada',
  'disposition.create': 'Classificação criada',
  'disposition.rename': 'Classificação renomeada',
  'disposition.retire': 'Classificação retirada',
  'survey.publish': 'Pesquisa publicada',
  'company.rename': 'Empresa renomeada',
  'company.concurrency_limit': 'Limite de concorrência alterado',
  'company.time_zone': 'Fuso horário alterado',
  'site.create': 'Site criado',
  'site.appearance_replace': 'Aparência do site alterada',
  'site.acceptance_set': 'Aceitação do site alterada',
  'site.origins_replace': 'Origens do site alteradas',
  'site.service_windows_replace': 'Horários do site alterados',
  'sla.publish': 'SLA publicado',
  'sla.retire': 'SLA retirado',
};

export function auditActionLabel(action: AuditAction): string {
  if (action.kind === 'unrecognized') return action.raw;
  return auditActionLabels[action.kind];
}
