import { createReadStream, existsSync } from 'node:fs';
import path from 'node:path';
import fastifyStatic from '@fastify/static';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { consoleDist, internalDist, widgetDist } from '../paths.js';

export type StaticRoots = { widget: string; console: string; internal: string };

const defaultRoots: StaticRoots = { widget: widgetDist, console: consoleDist, internal: internalDist };

export async function registerStatic(
  app: FastifyInstance,
  roots: StaticRoots = defaultRoots,
): Promise<void> {
  // O app interno é independente: sem o build dele, widget e console seguem como antes.
  if (existsSync(roots.internal)) {
    await app.register(fastifyStatic, {
      root: roots.internal,
      prefix: '/chat/',
      decorateReply: false,
      setHeaders: cacheHtml,
    });
    app.get('/chat', async (_request, reply) => reply.redirect('/chat/'));
  } else {
    app.log.warn('Build do app interno ausente. Rode pnpm build antes de servir /chat/.');
  }
  if (!existsSync(roots.widget) || !existsSync(roots.console)) {
    app.log.warn('Arquivos estáticos ausentes. Rode pnpm build antes de servir widget e console.');
    return;
  }
  await app.register(fastifyStatic, {
    root: roots.widget,
    prefix: '/widget/',
    decorateReply: false,
    setHeaders: cacheHtml,
  });
  await app.register(fastifyStatic, {
    root: roots.console,
    prefix: '/console/',
    decorateReply: false,
    setHeaders: cacheHtml,
  });
  app.get('/loader.js', async (_request, reply) => sendLoader(reply, roots.widget));
  app.get('/widget.js', async (_request, reply) => sendLoader(reply, roots.widget));
  app.get('/widget', async (_request, reply) => reply.redirect('/widget/'));
  app.get('/console', async (_request, reply) => reply.redirect('/console/'));
}

function sendLoader(reply: FastifyReply, widgetRoot: string) {
  return reply
    .type('text/javascript; charset=utf-8')
    .header('cache-control', 'no-cache')
    .send(createReadStream(path.join(widgetRoot, 'loader.js')));
}

function cacheHtml(
  reply: { header: (name: string, value: string) => unknown },
  filePath: string,
): void {
  if (filePath.endsWith('.html') || filePath.endsWith('loader.js')) {
    reply.header('cache-control', 'no-cache');
  }
}
