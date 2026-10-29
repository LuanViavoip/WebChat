import { knownAuditActions, type AgentAdmin } from '@viavoip/protocol';
import { describe, expect, it } from 'vitest';
import { describeInvalid } from '../src/admin/AdminContext.js';
import { auditActionLabels } from '../src/admin/audit-labels.js';
import { describeCalendar, minutesToTime, timeToMinutes } from '../src/admin/calendar.js';
import { parseOrigins } from '../src/admin/origins.js';
import { editCommands, placementOf } from '../src/admin/users.js';
import { widgetScript } from '../src/admin/widget-script.js';

const queueA = 'bbbbbbbb-2222-4222-8222-bbbbbbbbbb01';
const queueB = 'bbbbbbbb-2222-4222-8222-bbbbbbbbbb02';

function agent(placement: AgentAdmin['placement']): AgentAdmin {
  return {
    agentId: 'aaaaaaaa-1111-4111-8111-aaaaaaaaaa01',
    email: 'ana@tenant-a.local',
    name: 'Ana Lima',
    membership: { status: 'active' },
    placement,
  };
}

describe('script do widget', () => {
  it('usa a origem do console e o id público, sem tokens', () => {
    expect(widgetScript('https://chat.empresa.com.br', 'site_a')).toBe(
      '<script async src="https://chat.empresa.com.br/widget.js" data-widget-id="site_a"></script>',
    );
  });
});

describe('origens do site', () => {
  it('normaliza, remove repetidas e ignora linhas vazias', () => {
    const result = parseOrigins('https://www.empresa.com.br/\n\nhttps://www.empresa.com.br/contato\nhttp://localhost:3100');
    expect(result).toEqual({ ok: true, origins: ['https://www.empresa.com.br', 'http://localhost:3100'] });
  });

  it('recusa linhas que não são URL http(s)', () => {
    expect(parseOrigins('empresa.com.br').ok).toBe(false);
    expect(parseOrigins('ftp://empresa.com.br').ok).toBe(false);
  });

  it('limita a 20 origens', () => {
    const many = Array.from({ length: 21 }, (_, index) => `https://s${String(index)}.empresa.com.br`).join('\n');
    expect(parseOrigins(many).ok).toBe(false);
  });
});

describe('horários', () => {
  it('converte minutos e horário, com meia-noite no fim', () => {
    expect(minutesToTime(510)).toBe('08:30');
    expect(minutesToTime(1440)).toBe('24:00');
    expect(timeToMinutes('08:30', 'inicio')).toBe(510);
    expect(timeToMinutes('00:00', 'fim')).toBe(1440);
    expect(timeToMinutes('00:00', 'inicio')).toBe(0);
    expect(timeToMinutes('', 'inicio')).toBeNull();
  });

  it('descreve o calendário', () => {
    expect(describeCalendar({ kind: 'always_open' })).toBe('Sempre aberto');
    expect(
      describeCalendar({ kind: 'weekly', windows: [{ weekday: 1, startMinute: 480, endMinute: 1080 }, { weekday: 2, startMinute: 480, endMinute: 1080 }] }),
    ).toBe('2 janela(s) em Seg, Ter');
  });
});

describe('edição de usuário', () => {
  const base = agent({ role: 'agent', queueIds: [queueA], activityAuthority: { kind: 'assigned_only' } });

  it('não gera comando sem mudança', () => {
    expect(editCommands(base, { role: 'agent', queueIds: [queueA], authority: 'assigned_only' })).toEqual([]);
  });

  it('troca filas e autoridade com comandos próprios', () => {
    expect(editCommands(base, { role: 'agent', queueIds: [queueA, queueB], authority: 'self_service' })).toEqual([
      { kind: 'agent.queues_replace', agentId: base.agentId, queueIds: [queueA, queueB] },
      { kind: 'agent.activity_authority', agentId: base.agentId, activityAuthority: { kind: 'self_service' } },
    ]);
  });

  it('mudança de papel envia a lotação completa em um único comando', () => {
    expect(editCommands(base, { role: 'supervisor', queueIds: [queueA], authority: 'assigned_only' })).toEqual([
      { kind: 'agent.role_change', agentId: base.agentId, placement: { role: 'supervisor' } },
    ]);
    expect(placementOf({ role: 'agent', queueIds: [queueB], authority: 'self_service' })).toEqual({
      role: 'agent',
      queueIds: [queueB],
      activityAuthority: { kind: 'self_service' },
    });
  });
});

describe('auditoria', () => {
  it('tem rótulo em português para toda ação conhecida', () => {
    for (const action of knownAuditActions) expect(auditActionLabels[action].length).toBeGreaterThan(3);
  });
});

describe('mensagem de validação', () => {
  it('mostra mensagens próprias do protocolo e esconde as padrão do zod', () => {
    expect(describeInvalid({ issues: [{ path: ['calendar'], message: 'janelas sobrepostas' }] })).toBe('Confira os dados informados: janelas sobrepostas.');
    expect(describeInvalid({ issues: [{ path: ['password'], message: 'Too small' }] })).toBe('Confira os dados informados (password).');
    expect(describeInvalid({ issues: [] })).toBe('Confira os dados informados.');
  });
});
