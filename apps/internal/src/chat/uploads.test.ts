import { validateFiles } from '@viavoip/internal-domain';
import { beginUpload, nextUpload, type UploadEntry } from './uploads';

function png(): UploadEntry {
  const result = validateFiles([new File([new Uint8Array(100)], 'exame.png', { type: 'image/png' })]);
  if (!result?.ok) {
    throw new Error('anexo inválido no teste');
  }
  return beginUpload(result.attachment, 'legenda', 'blob:fake/1');
}

describe('nextUpload', () => {
  it('começa em uploading 0/total na tentativa 1', () => {
    const entry = png();
    expect(entry.attempt).toBe(1);
    expect(entry.view).toEqual({
      phase: 'uploading',
      loaded: 0,
      total: 100,
      fileName: 'exame.png',
    });
    expect(entry.caption).toBe('legenda');
    expect(entry.previewUrl).toBe('blob:fake/1');
  });

  it('aceita progresso da tentativa atual e ignora regressão', () => {
    const start = png();
    const progressed = nextUpload(start, { type: 'progress', attempt: 1, loaded: 40 });
    expect(progressed).not.toBe(start);
    if (progressed === 'removed' || progressed.view.phase !== 'uploading') {
      throw new Error('esperava uploading');
    }
    expect(progressed.view.loaded).toBe(40);
    const same = nextUpload(progressed, { type: 'progress', attempt: 1, loaded: 10 });
    expect(same).toBe(progressed);
    const capped = nextUpload(progressed, { type: 'progress', attempt: 1, loaded: 999 });
    if (capped === 'removed' || capped.view.phase !== 'uploading') {
      throw new Error('esperava uploading limitado');
    }
    expect(capped.view.loaded).toBe(100);
  });

  it('fail → retry zera loaded e incrementa attempt; succeed remove', () => {
    const start = png();
    const failed = nextUpload(start, { type: 'fail', attempt: 1, message: 'Falha ao enviar exame.png.' });
    if (failed === 'removed' || failed.view.phase !== 'failed') {
      throw new Error('esperava failed');
    }
    expect(failed.view.message).toBe('Falha ao enviar exame.png.');
    const retried = nextUpload(failed, { type: 'retry' });
    if (retried === 'removed' || retried.view.phase !== 'uploading') {
      throw new Error('esperava uploading no retry');
    }
    expect(retried.attempt).toBe(2);
    expect(retried.view.loaded).toBe(0);
    expect(nextUpload(retried, { type: 'succeed', attempt: 2 })).toBe('removed');
  });

  it('cancel remove em uploading e em failed', () => {
    const start = png();
    expect(nextUpload(start, { type: 'cancel' })).toBe('removed');
    const failed = nextUpload(start, { type: 'fail', attempt: 1, message: 'x' });
    if (failed === 'removed') {
      throw new Error('esperava failed');
    }
    expect(nextUpload(failed, { type: 'cancel' })).toBe('removed');
  });

  it('transições inválidas devolvem a mesma referência', () => {
    const start = png();
    const failed = nextUpload(start, { type: 'fail', attempt: 1, message: 'x' });
    if (failed === 'removed') {
      throw new Error('esperava failed');
    }
    expect(nextUpload(failed, { type: 'progress', attempt: 1, loaded: 10 })).toBe(failed);
    expect(nextUpload(start, { type: 'progress', attempt: 0, loaded: 10 })).toBe(start);
    expect(nextUpload(start, { type: 'retry' })).toBe(start);
    expect(nextUpload(start, { type: 'succeed', attempt: 9 })).toBe(start);
    expect(nextUpload(start, { type: 'fail', attempt: 9, message: 'x' })).toBe(start);
    expect(nextUpload(failed, { type: 'succeed', attempt: 1 })).toBe(failed);
  });
});
