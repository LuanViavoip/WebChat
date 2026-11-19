export type RecordingKind = 'audio' | 'video';

export type RecorderDeniedReason = 'permission' | 'no-device' | 'insecure-context' | 'unsupported';

export type RecorderState =
  | { readonly phase: 'idle' }
  | { readonly phase: 'requesting' }
  | { readonly phase: 'denied'; readonly reason: RecorderDeniedReason }
  | {
      readonly phase: 'recording';
      readonly kind: RecordingKind;
      readonly startedAt: number;
      readonly level: number;
    }
  | {
      readonly phase: 'done';
      readonly blob: Blob;
      readonly mimeType: string;
      readonly durationMs: number;
      readonly waveform: readonly number[];
    };

export type RecorderPhase = RecorderState['phase'];

export type StartRecordingOptions = {
  readonly maxDurationMs: number;
};

export interface RecorderPort {
  start(kind: RecordingKind, opts: StartRecordingOptions): Promise<void>;
  stop(): void;
  cancel(): void;
  getState(): RecorderState;
  subscribe(listener: (state: RecorderState) => void): () => void;
}

export type FakeRecorderOptions = {
  readonly now?: () => number;
  readonly denyReason?: RecorderDeniedReason | null;
  readonly defaultWaveform?: readonly number[];
  readonly initialLevel?: number;
};

function clampUnit(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(1, value));
}

export class FakeRecorder implements RecorderPort {
  private readonly now: () => number;
  private denyReason: RecorderDeniedReason | null;
  private readonly defaultWaveform: readonly number[];
  private readonly initialLevel: number;
  private state: RecorderState = { phase: 'idle' };
  private readonly listeners = new Set<(state: RecorderState) => void>();
  private samples: number[] = [];
  private maxDurationMs = 0;
  private sessionSeq = 0;
  private pendingGate: { resolve: () => void } | null = null;
  private holdNextRequest = false;

  constructor(options: FakeRecorderOptions = {}) {
    this.now = options.now ?? (() => Date.now());
    this.denyReason = options.denyReason ?? null;
    this.defaultWaveform = options.defaultWaveform ?? [0.25, 0.6, 0.85, 0.45];
    this.initialLevel = clampUnit(options.initialLevel ?? 0.35);
  }

  getState(): RecorderState {
    return this.state;
  }

  subscribe(listener: (state: RecorderState) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  setDenied(reason: RecorderDeniedReason | null): void {
    this.denyReason = reason;
  }

  holdRequesting(hold = true): void {
    this.holdNextRequest = hold;
  }

  releaseRequesting(): void {
    const gate = this.pendingGate;
    this.pendingGate = null;
    gate?.resolve();
  }

  setLevel(level: number): void {
    if (this.state.phase !== 'recording') {
      return;
    }
    const clamped = clampUnit(level);
    this.samples.push(clamped);
    this.emit({
      ...this.state,
      level: clamped,
    });
  }

  async start(kind: RecordingKind, opts: StartRecordingOptions): Promise<void> {
    const seq = ++this.sessionSeq;
    this.maxDurationMs = Math.max(0, opts.maxDurationMs);
    this.samples = [];
    this.emit({ phase: 'requesting' });

    if (this.holdNextRequest) {
      this.holdNextRequest = false;
      await new Promise<void>((resolve) => {
        this.pendingGate = { resolve };
      });
    } else {
      await Promise.resolve();
    }

    if (seq !== this.sessionSeq) {
      return;
    }

    if (this.denyReason) {
      this.emit({ phase: 'denied', reason: this.denyReason });
      return;
    }

    const level = this.initialLevel;
    this.samples = [level];
    this.emit({
      phase: 'recording',
      kind,
      startedAt: this.now(),
      level,
    });
  }

  stop(): void {
    if (this.state.phase !== 'recording') {
      return;
    }
    const { kind, startedAt } = this.state;
    const elapsed = Math.max(0, this.now() - startedAt);
    const durationMs = this.maxDurationMs > 0 ? Math.min(this.maxDurationMs, elapsed) : elapsed;
    const mimeType = kind === 'video' ? 'video/webm' : 'audio/webm';
    const waveform = this.samples.length > 0 ? [...this.samples] : [...this.defaultWaveform];
    const blob = new Blob([new Uint8Array([0x1a, 0x45, 0xdf, 0xa3])], { type: mimeType });
    this.emit({
      phase: 'done',
      blob,
      mimeType,
      durationMs,
      waveform,
    });
  }

  cancel(): void {
    this.sessionSeq += 1;
    this.pendingGate?.resolve();
    this.pendingGate = null;
    this.samples = [];
    if (this.state.phase === 'idle') {
      return;
    }
    this.emit({ phase: 'idle' });
  }

  reset(): void {
    this.cancel();
  }

  private emit(next: RecorderState): void {
    this.state = next;
    for (const listener of [...this.listeners]) {
      listener(next);
    }
  }
}
