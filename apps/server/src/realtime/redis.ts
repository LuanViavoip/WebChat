import { createAdapter } from '@socket.io/redis-adapter';
import { createClient, type RedisClientType } from 'redis';
import type { Server } from 'socket.io';

export async function attachRedis(io: Server, redisUrl: string): Promise<() => Promise<void>> {
  const pub = createClient({ url: redisUrl });
  const sub = pub.duplicate();
  await Promise.all([pub.connect(), sub.connect()]);
  io.adapter(createAdapter(pub, sub));
  return async () => {
    await Promise.all([quit(pub), quit(sub)]);
  };
}

async function quit(client: RedisClientType): Promise<void> {
  if (client.isOpen) await client.quit();
}
