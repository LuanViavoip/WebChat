import {
  publicWidgetSchema,
  visitorContextSchema,
  visitorSessionCreatedSchema,
  type PublicWidget,
  type VisitorContext,
  type VisitorSessionCreated,
} from '@viavoip/protocol';

export async function fetchPublicWidget(publicId: string): Promise<PublicWidget> {
  return publicWidgetSchema.parse(await request(`/public/widgets/${encodeURIComponent(publicId)}`));
}

export async function createVisitorSession(
  sitePublicId: string,
  parentOrigin: string,
): Promise<VisitorSessionCreated> {
  return visitorSessionCreatedSchema.parse(
    await request('/visitor/sessions', { method: 'POST', body: { sitePublicId, parentOrigin } }),
  );
}

export async function resumeVisitor(token: string): Promise<VisitorContext> {
  return visitorContextSchema.parse(
    await request('/visitor/me', { headers: { authorization: `Bearer ${token}` } }),
  );
}

async function request(
  path: string,
  init: { method?: string; body?: unknown; headers?: Record<string, string> } = {},
): Promise<unknown> {
  const headers = { ...(init.headers ?? {}) };
  if (init.body) headers['content-type'] = 'application/json';
  const response = await fetch(path, {
    method: init.method ?? 'GET',
    credentials: 'omit',
    headers,
    body: init.body ? JSON.stringify(init.body) : undefined,
  });
  const payload = (await response.json()) as unknown;
  if (!response.ok) throw new Error(messageOf(payload));
  return payload;
}

function messageOf(payload: unknown): string {
  if (payload && typeof payload === 'object' && 'error' in payload) {
    const message = (payload as { error?: { message?: string } }).error?.message;
    if (message) return message;
  }
  return 'Falha na comunicação';
}
