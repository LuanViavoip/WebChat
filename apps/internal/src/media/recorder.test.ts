import { describe, expect, it } from 'vitest';
import { FakeRecorder, type RecorderPhase } from './recorder';

describe('FakeRecorder', () => {
  it('percorre idle -> requesting -> recording -> done com blob, mime e waveform', async () => {
    let clock = 10_000;
    const recorder = new FakeRecorder({ now: () => clock });
    const phases: RecorderPhase[] = [recorder.getState().phase];
    const unsub = recorder.subscribe((state) => {
      phases.push(state.phase);
    });

    const starting = recorder.start('audio', { maxDurationMs: 15 * 60_000 });
    expect(recorder.getState().phase).toBe('requesting');

    await starting;
    expect(recorder.getState().phase).toBe('recording');

    recorder.setLevel(0.9);
    clock += 2_400;
    recorder.stop();

    const finalState = recorder.getState();
    expect(finalState.phase).toBe('done');
    if (finalState.phase === 'done') {
      expect(finalState.mimeType).toBe('audio/webm');
      expect(finalState.blob).toBeInstanceOf(Blob);
      expect(finalState.blob.size).toBeGreaterThan(0);
      expect(finalState.durationMs).toBe(2_400);
      expect(finalState.waveform).toEqual([0.35, 0.9]);
    }
    expect(phases).toEqual(['idle', 'requesting', 'recording', 'recording', 'done']);
    unsub();
  });

  it('usa video/webm e respeita maxDurationMs para gravação de vídeo', async () => {
    let clock = 50_000;
    const recorder = new FakeRecorder({ now: () => clock });
    await recorder.start('video', { maxDurationMs: 5_000 });

    clock += 12_000;
    recorder.stop();

    const finalState = recorder.getState();
    expect(finalState.phase).toBe('done');
    if (finalState.phase === 'done') {
      expect(finalState.mimeType).toBe('video/webm');
      expect(finalState.durationMs).toBe(5_000);
    }
  });

  it('cancela durante recording e volta para idle', async () => {
    const recorder = new FakeRecorder();
    await recorder.start('audio', { maxDurationMs: 60_000 });
    expect(recorder.getState().phase).toBe('recording');

    recorder.cancel();
    expect(recorder.getState()).toEqual({ phase: 'idle' });
  });

  it('cancela enquanto requesting sem deixar vazar para recording', async () => {
    const recorder = new FakeRecorder();
    recorder.holdRequesting(true);
    const starting = recorder.start('audio', { maxDurationMs: 60_000 });
    expect(recorder.getState().phase).toBe('requesting');

    recorder.cancel();
    await starting;
    expect(recorder.getState()).toEqual({ phase: 'idle' });
  });

  it('transiciona para denied quando permissão ou dispositivo é negado', async () => {
    const recorder = new FakeRecorder({ denyReason: 'permission' });
    const phases: RecorderPhase[] = [];
    recorder.subscribe((state) => phases.push(state.phase));

    await recorder.start('audio', { maxDurationMs: 60_000 });

    expect(recorder.getState()).toEqual({ phase: 'denied', reason: 'permission' });
    expect(phases).toEqual(['requesting', 'denied']);

    recorder.cancel();
    expect(recorder.getState()).toEqual({ phase: 'idle' });

    recorder.setDenied('no-device');
    await recorder.start('video', { maxDurationMs: 30_000 });
    expect(recorder.getState()).toEqual({ phase: 'denied', reason: 'no-device' });
  });
});
