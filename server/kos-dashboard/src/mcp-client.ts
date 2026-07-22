// MCP write client for the editor (F5). The ONLY write path in the dashboard —
// the SQL role is SELECT-only, so every mutation goes through here to the local
// `gbrain serve --http` on 127.0.0.1:7225 as the OAuth client `kos-dashboard`
// (write scope = `default`). Wire spec: docs/EXTERNAL-CLIENTS-MCP-WIRE-HANDOFF.md §5.2.
//
// Only put_page (save) and revert_version (rollback) are exposed. Reads (page
// list / detail / version history) all go through the RO SQL role instead —
// remote get_page/get_versions strip takes/facts fences (operations.ts:729/2542),
// which would corrupt an edit round-trip.

const MCP_BASE = process.env.KOS_DASH_MCP_BASE;
const CLIENT_ID = process.env.KOS_DASH_OAUTH_CLIENT_ID;
const CLIENT_SECRET = process.env.KOS_DASH_OAUTH_CLIENT_SECRET;

/** The write endpoints fail-fast (503) when this is false, rather than 500ing
 * mid-request. Read endpoints are unaffected. */
export function mcpWriteConfigured(): boolean {
  return Boolean(MCP_BASE && CLIENT_ID && CLIENT_SECRET);
}

let tokenCache: { token: string; expiresAt: number } | null = null;

async function getAccessToken(): Promise<string> {
  const now = Date.now();
  if (tokenCache && tokenCache.expiresAt > now + 60_000) return tokenCache.token;
  const r = await fetch(`${MCP_BASE}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: CLIENT_ID as string,
      client_secret: CLIENT_SECRET as string,
      scope: 'read write',
    }),
  });
  if (!r.ok) throw new Error(`OAuth /token HTTP ${r.status}`);
  const body = (await r.json()) as { access_token: string; expires_in: number };
  tokenCache = { token: body.access_token, expiresAt: now + body.expires_in * 1000 };
  return body.access_token;
}

async function mcpCall<T = unknown>(name: string, args: Record<string, unknown>, retried = false): Promise<T> {
  const token = await getAccessToken();
  const r = await fetch(`${MCP_BASE}/mcp`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      // Server returns SSE by default even for synchronous tools/call.
      Accept: 'application/json, text/event-stream',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: '1',
      method: 'tools/call',
      params: { name, arguments: args },
    }),
  });
  // A cached token can be rejected before its computed expiry (revoked, or the
  // serve process restarted and dropped its token store). Drop the cache,
  // re-mint once, and retry exactly once before surfacing the failure.
  if (r.status === 401 && !retried) {
    tokenCache = null;
    return mcpCall<T>(name, args, true);
  }
  if (!r.ok) throw new Error(`MCP ${name} HTTP ${r.status}`);

  // SSE (event: message\ndata: <JSON>) by default; fall back to plain JSON if
  // the server ever negotiates non-SSE.
  const contentType = r.headers.get('content-type') ?? '';
  let env: {
    error?: { message: string };
    result?: { content?: Array<{ text?: string }>; isError?: boolean };
  };
  if (contentType.includes('text/event-stream')) {
    const raw = await r.text();
    const dataLine = raw.split('\n').find(l => l.startsWith('data: '));
    if (!dataLine) throw new Error(`MCP ${name}: SSE response had no data line`);
    env = JSON.parse(dataLine.slice('data: '.length));
  } else {
    env = await r.json();
  }

  if (env.error) throw new Error(`MCP ${name} JSON-RPC error: ${env.error.message}`);
  const text = env.result?.content?.[0]?.text ?? '';
  if (env.result?.isError) {
    let detail = text;
    try {
      const e = JSON.parse(text) as { error?: string; message?: string };
      detail = `${e.error ?? 'error'}: ${e.message ?? text}`;
    } catch {
      /* non-JSON error text; use as-is */
    }
    throw new Error(`MCP ${name} op error (${detail})`);
  }
  // All op results are JSON.stringify-ed into content[0].text (dispatch.ts:254).
  return JSON.parse(text) as T;
}

export interface PutPageResult {
  slug: string;
  status: string;
  chunks?: number;
  [k: string]: unknown;
}

export function putPage(slug: string, content: string): Promise<PutPageResult> {
  return mcpCall<PutPageResult>('put_page', { slug, content });
}
