import type { Role } from '@viavoip/protocol';

export type Section =
  | 'overview'
  | 'agents'
  | 'desk'
  | 'internal'
  | 'sectors'
  | 'announcements'
  | 'activity';

export function isStaffRole(role: Role): boolean {
  switch (role) {
    case 'agent':
      return false;
    case 'supervisor':
    case 'admin':
      return true;
    default: {
      const unexpected: never = role;
      return unexpected;
    }
  }
}

export function staffNamespace(role: Role): '/agent' | '/supervisor' {
  switch (role) {
    case 'agent':
      return '/agent';
    case 'supervisor':
    case 'admin':
      return '/supervisor';
    default: {
      const unexpected: never = role;
      return unexpected;
    }
  }
}

export function roleLabel(role: Role): string {
  switch (role) {
    case 'agent':
      return 'Agente';
    case 'supervisor':
      return 'Supervisor';
    case 'admin':
      return 'Administração';
    default: {
      const unexpected: never = role;
      return unexpected;
    }
  }
}

export function sectionsFor(role: Role): { id: Section; label: string }[] {
  switch (role) {
    case 'agent':
      return [
        { id: 'desk', label: 'Atendimentos' },
        { id: 'internal', label: 'Chat interno' },
        { id: 'sectors', label: 'Setores' },
        { id: 'announcements', label: 'Anúncios' },
        { id: 'activity', label: 'Minha atividade' },
      ];
    case 'supervisor':
    case 'admin':
      return [
        { id: 'overview', label: 'Visão geral' },
        { id: 'agents', label: 'Agentes' },
        { id: 'sectors', label: 'Setores' },
        { id: 'desk', label: 'Atendimentos' },
        { id: 'activity', label: 'Atividades' },
        { id: 'announcements', label: 'Anúncios' },
        { id: 'internal', label: 'Chat interno' },
      ];
    default: {
      const unexpected: never = role;
      return unexpected;
    }
  }
}
