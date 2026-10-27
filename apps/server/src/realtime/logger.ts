export type AppLogger = {
  error: (obj: unknown, msg?: string) => void;
  info: (obj: unknown, msg?: string) => void;
  warn: (obj: unknown, msg?: string) => void;
};

export async function safeNotify(logger: AppLogger, label: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
    logger.info({ label }, 'notificação SM registrada');
  } catch (error) {
    logger.error({ err: error, label }, 'falha ao notificar o adaptador SM');
  }
}
