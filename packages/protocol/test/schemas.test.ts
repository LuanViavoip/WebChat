import { describe, expect, it } from 'vitest';
import {
  PARENT_SOURCE,
  WIDGET_SOURCE,
  conversationStartSchema,
  internalHistorySchema,
  isAllowedOrigin,
  messageSendSchema,
  parentOriginFromReferrer,
  parentToWidgetSchema,
  sectorSaveSchema,
  widgetToParentSchema,
} from '../src/index.js';

const queueId = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaa2';
const conversationId = 'cccccccc-1111-4111-8111-ccccccccccc1';
const requestId = 'dddddddd-1111-4111-8111-ddddddddddd1';

describe('protocolo de eventos', () => {
  it('aceita a abertura de conversa somente com a fila', () => {
    const parsed = conversationStartSchema.parse({ queueId });
    expect(parsed.queueId).toBe(queueId);
  });

  it('rejeita tenantId e campos desconhecidos', () => {
    expect(conversationStartSchema.safeParse({ queueId, tenantId: 'tenant-a' }).success).toBe(false);
    expect(messageSendSchema.safeParse({ conversationId, requestId, body: 'olá', extra: true }).success).toBe(
      false,
    );
    expect(sectorSaveSchema.safeParse({ name: 'Suporte', tenantId: conversationId }).success).toBe(false);
    expect(
      internalHistorySchema.safeParse({
        conversationId,
        beforeMessageId: requestId,
        afterMessageId: queueId,
      }).success,
    ).toBe(false);
  });

  it('rejeita corpo vazio, longo demais ou com caractere nulo', () => {
    expect(messageSendSchema.safeParse({ conversationId, requestId, body: '   ' }).success).toBe(false);
    expect(
      messageSendSchema.safeParse({ conversationId, requestId, body: 'a'.repeat(4001) }).success,
    ).toBe(false);
    expect(messageSendSchema.safeParse({ conversationId, requestId, body: 'a\u0000b' }).success).toBe(false);
  });
});

describe('postMessage', () => {
  it('aceita resize do widget e recusa origem curinga no payload', () => {
    expect(
      widgetToParentSchema.parse({
        source: WIDGET_SOURCE,
        type: 'resize',
        width: 380,
        height: 640,
      }),
    ).toMatchObject({ type: 'resize' });
    expect(
      parentToWidgetSchema.safeParse({ source: PARENT_SOURCE, type: 'open', targetOrigin: '*' }).success,
    ).toBe(false);
  });

  it('só reconhece a origem do referrer quando ela está na allowlist do site', () => {
    const allowed = ['http://localhost:8090'];
    expect(parentOriginFromReferrer('http://localhost:8090/pagina', allowed)).toBe('http://localhost:8090');
    expect(parentOriginFromReferrer('http://evil.example/', allowed)).toBeNull();
    expect(isAllowedOrigin('http://localhost:8090', allowed)).toBe(true);
  });
});
