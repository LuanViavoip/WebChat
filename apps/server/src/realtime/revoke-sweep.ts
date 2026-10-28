export const degradedSweepMs = 2_000;

export type SweepSocket = {
  data: { principal?: { sessionId?: string; kind?: string } };
  disconnect: (close?: boolean) => void;
};

export function createSweepLoop(input: {
  healthyMs: number;
  degradedMs: number;
  isDegraded: () => boolean;
  onTick: () => Promise<void>;
}): { stop: () => void; reschedule: () => void; intervalMs: () => number } {
  let timer: ReturnType<typeof setInterval> | undefined;
  let current = 0;
  const arm = () => {
    const next = input.isDegraded() ? input.degradedMs : input.healthyMs;
    if (timer && next === current) return;
    if (timer) clearInterval(timer);
    current = next;
    timer = setInterval(() => {
      void input.onTick();
    }, current);
    timer.unref?.();
  };
  arm();
  return {
    stop() {
      if (timer) clearInterval(timer);
      timer = undefined;
    },
    reschedule: arm,
    intervalMs: () => current,
  };
}

export async function sweepStaffSockets(
  sockets: readonly SweepSocket[],
  alive: (sessionIds: string[]) => Promise<ReadonlyMap<string, string>>,
): Promise<void> {
  const staff = sockets.flatMap((socket) => {
    const sessionId = socket.data.principal?.sessionId;
    const kind = socket.data.principal?.kind;
    if (!sessionId || !kind) return [];
    return [{ socket, sessionId, kind }];
  });
  if (staff.length === 0) return;
  const living = await alive(staff.map((item) => item.sessionId));
  for (const item of staff) {
    if (living.get(item.sessionId) !== item.kind) item.socket.disconnect(true);
  }
}
