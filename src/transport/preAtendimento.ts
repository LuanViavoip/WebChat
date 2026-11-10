import type { MenuOption } from '../domain/message';

export const PRE_ATENDIMENTO_MENU: MenuOption[] = [
  { key: '1', label: 'Primeira vez / Orientação' },
  { key: '2', label: 'Acompanhar minha saúde (Rotina/Exames/Vacinas)' },
  { key: '3', label: 'Falar com minha equipe (APS/Crônicos)' },
  { key: '4', label: 'Agendamentos (Consultas/Exames)' },
  { key: '0', label: 'Encerrar o Atendimento' },
];

export function welcomeText(patientName: string): string {
  const lines = [
    `Olá, ${patientName}!`,
    'Como posso ajudar? Por favor, digite o número da opção:',
    '',
    '1 Primeira vez / Orientação',
    '2 Acompanhar minha saúde (Rotina/Exames/Vacinas)',
    '3 Falar com minha equipe (APS/Crônicos)',
    '4 Agendamentos (Consultas/Exames)',
    '0 Encerrar o Atendimento',
  ];
  return lines.join('\n');
}

export function replyForChoice(choice: string): { text: string; menu?: MenuOption[]; ended: boolean } {
  const key = choice.trim();
  switch (key) {
    case '1':
      return {
        text: 'Você escolheu Primeira vez / Orientação. Em breve um profissional da equipe vai te orientar sobre o cadastro e o primeiro atendimento na unidade.',
        menu: PRE_ATENDIMENTO_MENU,
        ended: false,
      };
    case '2':
      return {
        text: 'Você escolheu Acompanhar minha saúde (Rotina/Exames/Vacinas). Posso te ajudar a consultar resultados, rotina e vacinas — este canal ainda está em simulação.',
        menu: PRE_ATENDIMENTO_MENU,
        ended: false,
      };
    case '3':
      return {
        text: 'Você escolheu Falar com minha equipe (APS/Crônicos). Vou te encaminhar para a fila da sua equipe de referência.',
        menu: PRE_ATENDIMENTO_MENU,
        ended: false,
      };
    case '4':
      return {
        text: 'Você escolheu Agendamentos (Consultas/Exames). Informe o que deseja agendar na próxima etapa do atendimento.',
        menu: PRE_ATENDIMENTO_MENU,
        ended: false,
      };
    case '0':
      return {
        text: 'Atendimento encerrado. Obrigado por falar com o ICS. Quando quiser, abra o chat novamente.',
        ended: true,
      };
    default:
      return {
        text: 'Não entendi. Por favor, digite o número da opção:\n\n1 Primeira vez / Orientação\n2 Acompanhar minha saúde (Rotina/Exames/Vacinas)\n3 Falar com minha equipe (APS/Crônicos)\n4 Agendamentos (Consultas/Exames)\n0 Encerrar o Atendimento',
        menu: PRE_ATENDIMENTO_MENU,
        ended: false,
      };
  }
}
