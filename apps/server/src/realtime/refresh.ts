import { supervisorSnapshotSchema } from '@viavoip/protocol';
import type { Server } from 'socket.io';
import { isStaff } from '../domain/access.js';
import type { AgentPrincipal } from '../domain/types.js';
import type { SupervisorService } from '../modules/supervisor.js';
import type { AppLogger } from './logger.js';

export async function refreshSupervisors(
  io: Server,
  supervisor: SupervisorService,
  tenantId: string,
  logger: AppLogger,
): Promise<void> {
  try {
    const sockets = await io.of('/supervisor').fetchSockets();
    for (const socket of sockets) {
      const principal = socket.data.principal as AgentPrincipal | undefined;
      if (!principal || !isStaff(principal.kind)) continue;
      if (principal.tenantId !== tenantId) continue;
      const snapshot = await supervisor.snapshot(principal, {});
      socket.emit('supervisor.metrics', supervisorSnapshotSchema.parse(snapshot));
    }
  } catch (error) {
    logger.error({ err: error }, 'falha ao atualizar a supervisão');
  }
}
