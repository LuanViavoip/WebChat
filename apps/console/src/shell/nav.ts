import {
  Activity,
  BarChart3,
  Headset,
  LayoutDashboard,
  Megaphone,
  MessagesSquare,
  Network,
  Settings,
  Users,
  type LucideIcon,
} from 'lucide-react';
import type { Role } from '@viavoip/protocol';
import type { NavGroup } from '../ui/Sidebar.js';
import type { RouteSlugs } from '../ui/route.js';
import { sectionsFor, type Section } from './roles.js';

/** Slugs de URL (`#/atendimentos`). A permissão continua vindo só de `sectionsFor()`. */
export const sectionSlugs: RouteSlugs<Section> = {
  overview: 'visao-geral',
  agents: 'agentes',
  desk: 'atendimentos',
  internal: 'chat-interno',
  sectors: 'setores',
  announcements: 'anuncios',
  activity: 'atividades',
  company: 'administracao',
  quality: 'qualidade',
};

const sectionIcons: Record<Section, LucideIcon> = {
  overview: LayoutDashboard,
  agents: Users,
  desk: Headset,
  internal: MessagesSquare,
  sectors: Network,
  announcements: Megaphone,
  activity: Activity,
  company: Settings,
  quality: BarChart3,
};

type GroupId = 'atendimento' | 'gestao' | 'equipe' | 'sistema';

const groupOf: Record<Section, GroupId> = {
  desk: 'atendimento',
  internal: 'atendimento',
  overview: 'gestao',
  agents: 'gestao',
  quality: 'gestao',
  sectors: 'equipe',
  activity: 'equipe',
  announcements: 'equipe',
  company: 'sistema',
};

const groupLabels: Record<GroupId, string> = {
  atendimento: 'Atendimento',
  gestao: 'Gestão',
  equipe: 'Equipe',
  sistema: 'Sistema',
};

const groupOrder: GroupId[] = ['atendimento', 'gestao', 'equipe', 'sistema'];

/** Agrupa as seções do papel para a sidebar, preservando a ordem de `sectionsFor()` dentro de cada grupo. */
export function navGroups(role: Role, badges: Partial<Record<Section, number>> = {}): NavGroup[] {
  const sections = sectionsFor(role);
  return groupOrder.flatMap((groupId) => {
    const items = sections
      .filter((section) => groupOf[section.id] === groupId)
      .map((section) => {
        const badge = badges[section.id];
        return {
          id: section.id,
          label: section.label,
          icon: sectionIcons[section.id],
          ...(badge ? { badge } : {}),
        };
      });
    return items.length > 0 ? [{ id: groupId, label: groupLabels[groupId], items }] : [];
  });
}

export function sectionTitle(role: Role, section: Section): string {
  return sectionsFor(role).find((item) => item.id === section)?.label ?? 'Central';
}
