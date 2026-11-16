import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { registerStatic } from '../src/http/static.js';

let root: string;
let app: FastifyInstance | undefined;

function dist(name: string, files: Record<string, string>): string {
  const dir = path.join(root, name);
  mkdirSync(path.join(dir, 'assets'), { recursive: true });
  for (const [file, content] of Object.entries(files)) writeFileSync(path.join(dir, file), content);
  return dir;
}

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'static-test-'));
});

afterEach(async () => {
  await app?.close();
  app = undefined;
  rmSync(root, { recursive: true, force: true });
});

async function build(withInternal: boolean): Promise<FastifyInstance> {
  const widget = dist('widget', { 'index.html': '<title>widget</title>', 'loader.js': '//loader' });
  const console = dist('console', { 'index.html': '<title>console</title>' });
  const internal = withInternal
    ? dist('internal', {
        'index.html': '<!doctype html><title>chat interno</title><div id="root"></div>',
        'assets/app.js': 'export {};',
      })
    : path.join(root, 'internal-ausente');
  app = Fastify({ logger: false });
  await registerStatic(app, { widget, console, internal });
  return app;
}

describe('arquivos estáticos', () => {
  it('serve o app interno em /chat/ como HTML', async () => {
    const response = await (await build(true)).inject({ method: 'GET', url: '/chat/' });
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('text/html');
    expect(response.headers['cache-control']).toBe('no-cache');
    expect(response.body).toContain('<title>chat interno</title>');
  });

  it('serve os assets de /chat/assets/', async () => {
    const response = await (await build(true)).inject({ method: 'GET', url: '/chat/assets/app.js' });
    expect(response.statusCode).toBe(200);
    expect(response.body).toBe('export {};');
  });

  it('redireciona /chat para /chat/', async () => {
    const response = await (await build(true)).inject({ method: 'GET', url: '/chat' });
    expect(response.statusCode).toBe(302);
    expect(response.headers.location).toBe('/chat/');
  });

  it('mantém /widget/, /console/ e o loader como antes', async () => {
    const server = await build(true);
    expect((await server.inject({ method: 'GET', url: '/widget/' })).statusCode).toBe(200);
    expect((await server.inject({ method: 'GET', url: '/console/' })).statusCode).toBe(200);
    expect((await server.inject({ method: 'GET', url: '/widget.js' })).statusCode).toBe(200);
    expect((await server.inject({ method: 'GET', url: '/console' })).headers.location).toBe('/console/');
  });

  it('sem o build do app interno, widget e console continuam servidos e /chat/ não existe', async () => {
    const server = await build(false);
    expect((await server.inject({ method: 'GET', url: '/widget/' })).statusCode).toBe(200);
    expect((await server.inject({ method: 'GET', url: '/console/' })).statusCode).toBe(200);
    expect((await server.inject({ method: 'GET', url: '/chat/' })).statusCode).toBe(404);
    expect((await server.inject({ method: 'GET', url: '/chat' })).statusCode).toBe(404);
  });
});
