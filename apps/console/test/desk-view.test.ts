import type { MessageRecord } from '@viavoip/protocol';
import { describe, expect, it } from 'vitest';
import { linkLabel, presenceLabel } from '../src/desk/format.js';
import { deskLayout } from '../src/desk/layout.js';
import { dayKey, dayLabel, groupMessagesByDay, lastMessagePreview } from '../src/desk/state.js';
import { initials } from '../src/ui/Avatar.js';

function message(id: number, createdAt: Date, body = `mensagem ${String(id)}`): MessageRecord {
  const suffix = String(id).padStart(12, '0');
  return {
    id: `aaaaaaaa-1111-4111-8111-${suffix}`,
    conversationId: 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbb1',
    senderType: 'visitor',
    senderId: null,
    requestId: `dddddddd-4444-4444-8444-${suffix}`,
    body,
    createdAt: createdAt.toISOString(),
  };
}

// Datas montadas com componentes locais para o teste valer em qualquer fuso.
const now = new Date(2026, 5, 10, 15, 0, 0).getTime();

describe('groupMessagesByDay', () => {
  it('separa por dia local e rotula Hoje e Ontem', () => {
    const groups = groupMessagesByDay(
      [
        message(1, new Date(2026, 5, 8, 23, 59)),
        message(2, new Date(2026, 5, 9, 0, 1)),
        message(3, new Date(2026, 5, 9, 18, 30)),
        message(4, new Date(2026, 5, 10, 9, 0)),
      ],
      now,
    );
    expect(groups.map((group) => group.label)).toEqual(['8 de junho de 2026', 'Ontem', 'Hoje']);
    expect(groups.map((group) => group.messages.length)).toEqual([1, 2, 1]);
  });

  it('preserva a ordem e devolve lista vazia sem mensagens', () => {
    expect(groupMessagesByDay([], now)).toEqual([]);
    const [group] = groupMessagesByDay([message(1, new Date(2026, 5, 10, 8)), message(2, new Date(2026, 5, 10, 9))], now);
    expect(group?.messages.map((item) => item.body)).toEqual(['mensagem 1', 'mensagem 2']);
  });

  it('trata o dia anterior à virada do mês como Ontem', () => {
    const firstOfMonth = new Date(2026, 6, 1, 10).getTime();
    expect(dayLabel(new Date(2026, 5, 30, 22).toISOString(), firstOfMonth)).toBe('Ontem');
    expect(dayKey(new Date(2026, 5, 30, 22))).toBe('2026-06-30');
  });
});

describe('lastMessagePreview', () => {
  it('é nula sem mensagens carregadas', () => {
    expect(lastMessagePreview(undefined)).toBeNull();
    expect(lastMessagePreview([])).toBeNull();
  });

  it('usa a última mensagem e junta quebras de linha', () => {
    const preview = lastMessagePreview([
      message(1, new Date(2026, 5, 10, 8), 'primeira'),
      message(2, new Date(2026, 5, 10, 9), '  olá,\n\n  tudo bem?  '),
    ]);
    expect(preview?.text).toBe('olá, tudo bem?');
    expect(preview?.senderType).toBe('visitor');
  });
});

describe('rótulos de presença e conectividade', () => {
  it('chama a presença offline de Offline, sem confundir com conexão', () => {
    expect(presenceLabel('offline')).toBe('Offline');
    expect(presenceLabel('available')).toBe('Disponível');
    expect(linkLabel('disconnected')).toBe('Desconectado');
    expect(linkLabel('reconnecting')).toBe('Reconectando');
    expect(linkLabel('connected')).toBe('Conectado');
  });
});

describe('deskLayout', () => {
  it('escolhe 3 colunas, lista com gaveta ou telas separadas pela largura da área', () => {
    expect(deskLayout(1118)).toBe('wide');
    expect(deskLayout(960)).toBe('wide');
    expect(deskLayout(959)).toBe('medium');
    expect(deskLayout(680)).toBe('medium');
    expect(deskLayout(679)).toBe('narrow');
    expect(deskLayout(366)).toBe('narrow');
  });
});

describe('initials', () => {
  it('usa primeira e última palavra', () => {
    expect(initials('Ana Lima')).toBe('AL');
    expect(initials('Maria da Silva Souza')).toBe('MS');
    expect(initials('visitante')).toBe('V');
    expect(initials('  ')).toBe('?');
    expect(initials(null)).toBe('?');
  });
});
