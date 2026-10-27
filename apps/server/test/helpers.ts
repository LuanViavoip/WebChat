import type { AddressInfo } from 'node:net';
import {
  conversationSnapshotAckSchema,
  historySyncAckSchema,
  loginResponseSchema,
  messageSendAckSchema,
  visitorSessionCreatedSchema,
} from '@viavoip/protocol';
import { MockSMAdapter } from '@viavoip/sm-adapter';
import { io, type Socket } from 'socket.io-client';
import { buildApp, type WebChatApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';

export type TestApp = WebChatApp & {
  sm: MockSMAdapter;
  baseUrl: string;
};

export async function startTestApp(overrides: Partial<ReturnType<typeof loadConfig>> = {}): Promise<TestApp> {
  const config = loadConfig();
  const sm = new MockSMAdapter();
  const web = await buildApp(
    { ...config, redisUrl: null, seed: false, serveStatic: false, logger: false, ...overrides },
    sm,
  );
  await web.app.listen({ port: 0, host: '127.0.0.1' });
  const address = web.app.server.address() as AddressInfo;
  return { ...web, sm, baseUrl: `http://127.0.0.1:${address.port}` };
}

export async function postJson(url: string, body: unknown, token?: string) {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (token) headers.authorization = `Bearer ${token}`;
  const response = await fetch(url, { method: 'POST', body: JSON.stringify(body), headers });
  return { status: response.status, payload: (await response.json()) as unknown };
}

export const demoParentOrigin = 'http://localhost:8090';

export async function openVisitor(baseUrl: string, sitePublicId: string, parentOrigin = demoParentOrigin) {
  const response = await postJson(`${baseUrl}/visitor/sessions`, { sitePublicId, parentOrigin });
  if (response.status !== 200) throw new Error(`sessão recusada: ${response.status}`);
  const session = visitorSessionCreatedSchema.parse(response.payload);
  const socket = connectSocket(baseUrl, '/visitor', session.token);
  await waitConnect(socket);
  return { session, socket };
}

export async function login(baseUrl: string, email: string, password: string) {
  const response = await postJson(`${baseUrl}/auth/login`, { email, password });
  if (response.status !== 200) throw new Error(`login recusado: ${response.status}`);
  return loginResponseSchema.parse(response.payload);
}

export function connectSocket(baseUrl: string, namespace: string, token: string): Socket {
  return io(`${baseUrl}${namespace}`, {
    auth: { token },
    transports: ['websocket'],
    reconnection: false,
    forceNew: true,
  });
}

export function waitConnect(socket: Socket): Promise<void> {
  if (socket.connected) return Promise.resolve();
  return new Promise((resolve, reject) => {
    socket.once('connect', () => resolve());
    socket.once('connect_error', (error: Error) => reject(error));
  });
}

export function waitEvent(socket: Socket, event: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout ${event}`)), 5000);
    socket.once(event, (payload: unknown) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
}

export function emitAck(socket: Socket, event: string, payload: unknown = {}): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout ${event}`)), 5000);
    socket.emit(event, payload, (response: unknown) => {
      clearTimeout(timer);
      resolve(response);
    });
  });
}

export async function startConversation(socket: Socket, queueId: string, displayName?: string) {
  const parsed = conversationSnapshotAckSchema.parse(
    await emitAck(socket, 'conversation.start', {
      queueId,
      ...(displayName ? { displayName } : {}),
    }),
  );
  if (!parsed.ok) throw new Error(parsed.error.message);
  return parsed;
}

export async function sendMessage(socket: Socket, conversationId: string, requestId: string, body: string) {
  const parsed = messageSendAckSchema.parse(
    await emitAck(socket, 'message.send', { conversationId, requestId, body }),
  );
  return parsed;
}

export async function syncHistory(socket: Socket, conversationId: string) {
  const parsed = historySyncAckSchema.parse(await emitAck(socket, 'history.sync', { conversationId }));
  if (!parsed.ok) throw new Error(parsed.error.message);
  return parsed;
}
