// Cloudflare Workers の入口。画面（dist/）は静的アセットとして配信され、/api/* だけがここに来る。
import { Hono } from 'hono';
import { checkAccess, type AccessEnv } from './access.ts';
import { langOf, withLang } from './lang.ts';
import { api, type ApiEnv } from './app.ts';
import { setCacheStore } from './cache.ts';
import { setPrefsStore } from './prefs.ts';
import { withYahooSession } from './yahoo.ts';

interface Env extends AccessEnv {
  CACHE?: KVNamespace;
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

app.route('/api', api);

export default app;
