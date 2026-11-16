import { validateFiles, type ValidAttachment } from '../domain/attachment';
import { payloadForAttachment } from './outbound';

function png(): ValidAttachment {
  const result = validateFiles([new File([new Uint8Array(12)], 'exame.png', { type: 'image/png' })]);
  if (!result?.ok) {
    throw new Error('anexo inválido no teste');
  }
  return result.attachment;
}

describe('payloadForAttachment', () => {
  it('trunca a legenda em 1024 caracteres', () => {
    const payload = payloadForAttachment(png(), 'blob:x', 'x'.repeat(1500));
    expect(payload.type).toBe('image');
    if (payload.type !== 'image') {
      return;
    }
    expect(payload.caption).toHaveLength(1024);
  });
});
