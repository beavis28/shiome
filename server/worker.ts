// Cloudflare Workers の入口。画面（dist/）は静的アセットとして配信され、/api/* だけがここに来る。
import { DurableObject } from 'cloudflare:workers';
import { Hono } from 'hono';
import { PriceHub, type HubClient } from './hub.ts';
import { checkAccess, type AccessEnv } from './access.ts';
import { langOf, withLang } from './lang.ts';
import { api, type ApiEnv } from './app.ts';
import { setCacheStore } from './cache.ts';
import { setPrefsStore } from './prefs.ts';
import { withYahooSession } from './yahoo.ts';

interface Env extends AccessEnv {
  CACHE?: KVNamespace;
  PRICE_HUB?: DurableObjectNamespace<PriceHubDO>;
  FINNHUB_API_KEY?: string;
  [key: string]: unknown;
}

const app = new Hono<{ Bindings: Env } & ApiEnv>();

app.use('/api/*', async (c, next) => {
  // Secret / 環境変数を process.env に反映（共通コードは process.env を読む）
  for (const [k, v] of Object.entries(c.env)) if (typeof v === 'string') process.env[k] = v;
  const kv = c.env.CACHE;
  setCacheStore(
    kv
      ? {
          get: (key) => kv.get(key),
          put: (key, value, ttlSec) => kv.put(key, value, { expirationTtl: ttlSec }),
        }
      : null,
  );
  setPrefsStore(kv ? { get: (key) => kv.get(key), put: (key, value) => kv.put(key, value) } : null);
  const auth = await withLang(langOf(c.req.header('x-lang')), () => checkAccess(c.req.raw, c.env));
  if (!auth.ok) return c.json({ error: auth.error }, auth.status);
  c.set('userEmail', auth.email);
  await withYahooSession(() => next());
});

// リアルタイム株価（WebSocket）。ログインの確認は上の middleware で済んでいる。
// 上流への接続を 1 本にするため、全員を同じ Durable Object（名前 "hub"）に渡す
app.get('/api/stream', async (c) => {
  if (c.req.header('upgrade')?.toLowerCase() !== 'websocket') return c.json({ error: 'WebSocket only' }, 426);
  if (!c.env.PRICE_HUB) return c.json({ error: 'PRICE_HUB is not configured' }, 503);
  const stub = c.env.PRICE_HUB.get(c.env.PRICE_HUB.idFromName('hub'));
  return (await stub.fetch(c.req.raw)) as unknown as Response;
});

app.route('/api', api);

export default app;

/** 上流（Finnhub）への接続を 1 本だけ持ち、開いている画面すべてに株価を配る */
export class PriceHubDO extends DurableObject<Env> {
  private hub = new PriceHub(() => this.env.FINNHUB_API_KEY);

  async fetch(): Promise<Response> {
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    server.accept();
    const c: HubClient = {
      symbols: new Set(),
      send: (d) => {
        try {
          server.send(d);
        } catch {
          /* 閉じたあと */
        }
      },
    };
    this.hub.add(c);
    server.addEventListener('message', (e) => this.hub.message(c, typeof e.data === 'string' ? e.data : ''));
    const bye = () => this.hub.remove(c);
    server.addEventListener('close', bye);
    server.addEventListener('error', bye);
    return new Response(null, { status: 101, webSocket: client });
  }
}
