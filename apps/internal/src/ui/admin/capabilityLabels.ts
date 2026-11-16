import type { Capability } from '@viavoip/internal-domain';

/**
 * Rótulo e explicação de cada capacidade. É um `Record` exaustivo de propósito: capacidade nova no catálogo
 * (`CAPABILITIES`) não compila sem rótulo. A LISTA de chaves na tela vem sempre do catálogo, nunca daqui.
 */
export const CAPABILITY_TEXT: Readonly<Record<Capability, { readonly label: string; readonly hint: string }>> = {
  'chat.use': { label: 'Usar o chat', hint: 'Conversar em diretas e grupos.' },
  'group.manage': { label: 'Criar e editar grupos', hint: 'Cria e edita os próprios grupos.' },
  'announcement.publish': { label: 'Publicar avisos', hint: 'Publica, edita e expira os próprios avisos.' },
  'announcement.receipts': { label: 'Ver quem leu os avisos', hint: 'Vê quem viu e quem deu ciência.' },
  'announcement.moderate': { label: 'Moderar comentários dos avisos', hint: 'Modera os comentários dos próprios avisos.' },
  'agents.manage': { label: 'Gerenciar agentes', hint: 'Cadastra, move e desativa agentes.' },
  'ilhas.manage': { label: 'Gerenciar ilhas', hint: 'Cria e renomeia ilhas e atribui supervisor.' },
  'supervisors.manage': { label: 'Gerenciar supervisores', hint: 'Cadastra e desativa supervisores.' },
  'grants.manage': { label: 'Gerenciar permissões', hint: 'Concede e revoga permissões de quem está abaixo.' },
  'admin.console': { label: 'Acessar a Administração', hint: 'Vê a tela de administração.' },
};

export function capabilityLabel(capability: Capability): string {
  return CAPABILITY_TEXT[capability].label;
}
