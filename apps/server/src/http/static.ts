import { createReadStream, existsSync } from 'node:fs';
import path from 'node:path';
import fastifyStatic from '@fastify/static';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { consoleDist, widgetDist } from '../paths.js';

export async function registerStatic(app: FastifyInstance): Promise<void> {
  if (!existsSync(widgetDist) || !existsSync(consoleDist)) {
    app.log.warn('Arquivos estáticos ausentes. Rode pnpm build antes de servir widget e console.');
    return;
  }
  await app.register(fastifyStatic, {
    root: widgetDist,
    prefix: '/widget/',
    decorateReply: false,
    setHeaders: cacheHtml,
  });
  await app.register(fastifyStatic, {
    root: consoleDist,
    prefix: '/console/',
    decorateReply: false,
    setHeaders: cacheHtml,
  });
  app.get('/loader.js', async (_request, reply) => sendLoader(reply));
  app.get('/widget.js', async (_request, reply) => sendLoader(reply));
  app.get('/widget', async (_request, reply) => reply.redirect('/widget/'));
  app.get('/console', async (_request, reply) => reply.redirect('/console/'));
}

function sendLoader(reply: FastifyReply) {
  return reply
    .type('text/javascript; charset=utf-8')
    .header('cache-control', 'no-cache')
    .send(createReadStream(path.join(widgetDist, 'loader.js')));
}

function cacheHtml(
  reply: { header: (name: string, value: string) => unknown },
  filePath: string,
): void {
  if (filePath.endsWith('.html') || filePath.endsWith('loader.js')) {
    reply.header('cache-control', 'no-cache');
  }
}
