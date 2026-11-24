// API のルート定義（Hono）。Node（server/node.ts）と Cloudflare Workers（server/worker.ts）で共通。
// キーは process.env から読み、ブラウザには渡さない。
import { Hono } from 'hono';
import type { AppConfig, Valuation } from '../src/types.ts';
import { chatStream, type ChatMessage } from './chat.ts';
import { demoStock } from './demo.ts';
import { fetchEcon } from './econ.ts';
import { fetchMacro } from './macro.ts';
import { liveVideoId } from './tv.ts';
import { validateSymbol } from './fmp.ts';
import { readTickersWithClaude } from './ocr.ts';
import { fetchQuotes, fetchStock } from './stock.ts';
import { MAJOR_SYMBOLS } from './universe.ts';
import { yahooHeatmap, yahooNews, yahooValuation } from './yahoo.ts';

const SYMBOL_RE = /^[A-Z]{1,5}([.-][A-Z]{1,2})?$/;
const parseSymbols = (v: unknown) =>
  [...new Set(String(v ?? '').split(',').map((s) => s.trim().toUpperCase()))].filter((s) => SYMBOL_RE.test(s));
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

// DEMO=1 のときだけ架空のデモデータを使う（通常は Yahoo / FMP の実データ）
export const config = (): AppConfig => ({
  yahoo: true,
  demo: process.env.DEMO === '1',
  fmp: !!process.env.FMP_API_KEY,
  fred: !!process.env.FRED_API_KEY,
  anthropic: !!process.env.ANTHROPIC_API_KEY,
  exa: !!process.env.EXA_API_KEY,
  tavily: !!process.env.TAVILY_API_KEY,
});

/** worker.ts が Access のログイン情報を入れる */
export type ApiEnv = { Variables: { userEmail: string | null } };

export const api = new Hono<ApiEnv>();

api.get('/me', (c) => c.json({ email: c.get('userEmail') ?? null }));

api.post('/chat', async (c) => {
  if (!config().anthropic) return c.json({ error: 'ANTHROPIC_API_KEY が未設定です' }, 400);
  const raw = await c.req.text();
  if (raw.length > 300_000) return c.json({ error: '送信データが大きすぎます' }, 413);
  let body: { messages?: ChatMessage[]; dashboard?: unknown; webSearch?: boolean };
  try {
    body = JSON.parse(raw);
  } catch {
    return c.json({ error: 'JSON が不正です' }, 400);
  }
  const messages = (body.messages ?? [])
    .filter((m) => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
    .slice(-30)
    .map((m) => ({ role: m.role, content: m.content.slice(0, 8000) }));
  if (!messages.length || messages[messages.length - 1].role !== 'user') return c.json({ error: '質問がありません' }, 400);
  return new Response(chatStream(messages, body.dashboard ?? {}, { webSearch: body.webSearch !== false }), {
    headers: { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store' },
  });
});

api.get('/config', (c) => c.json(config()));

api.get('/stock/:symbol', async (c) => {
  const symbol = c.req.param('symbol').toUpperCase();
  if (!SYMBOL_RE.test(symbol)) return c.json({ error: 'ティッカーの形式が正しくありません' }, 400);
  return c.json(config().demo ? demoStock(symbol) : await fetchStock(symbol));
});

api.get('/quotes', async (c) => {
  const symbols = parseSymbols(c.req.query('symbols')).slice(0, 50);
  if (config().demo || !symbols.length) return c.json({ quotes: {}, at: new Date().toISOString() });
  return c.json({ quotes: await fetchQuotes(symbols), at: new Date().toISOString() });
});

api.get('/news/:symbol', async (c) => {
  const symbol = c.req.param('symbol').toUpperCase();
  if (!SYMBOL_RE.test(symbol)) return c.json({ error: 'ティッカーの形式が正しくありません' }, 400);
  try {
    return c.json({ news: await yahooNews(symbol) });
  } catch (e) {
    return c.json({ error: `ニュースを取得できませんでした（${msg(e)}）` }, 502);
  }
});

api.get('/valuation', async (c) => {
  const symbols = parseSymbols(c.req.query('symbols')).slice(0, 20);
  const data: Record<string, Valuation> = {};
  const errors: Record<string, string> = {};
  await Promise.all(
    symbols.map(async (s) => {
      try {
        data[s] = await yahooValuation(s);
      } catch (e) {
        errors[s] = msg(e);
      }
    }),
  );
  return c.json({ data, errors });
});

api.get('/heatmap', async (c) => {
  const universe = c.req.query('universe') === 'watchlist' ? 'watchlist' : 'major';
  const symbols = universe === 'watchlist' ? parseSymbols(c.req.query('symbols')).slice(0, 60) : MAJOR_SYMBOLS;
  if (!symbols.length) return c.json({ items: [], missing: [], asOf: new Date().toISOString() });
  try {
    const r = await yahooHeatmap(symbols);
    return c.json({ ...r, asOf: new Date().toISOString() });
  } catch (e) {
    return c.json({ error: `ヒートマップのデータを取得できませんでした（${msg(e)}）` }, 502);
  }
});

api.get('/tv/:channel', async (c) => {
  try {
    return c.json({ videoId: await liveVideoId(c.req.param('channel')) });
  } catch {
    return c.json({ videoId: null });
  }
});

api.get('/macro', async (c) => c.json(await fetchMacro()));

api.get('/econ', async (c) => c.json(await fetchEcon()));

api.get('/validate', async (c) => {
  const symbols = parseSymbols(c.req.query('symbols')).slice(0, 30);
  if (!config().fmp) return c.json({ checked: false, results: {} });
  const results: Record<string, { name: string; exchange: string } | null> = {};
  await Promise.all(
    symbols.map(async (s) => {
      try {
        results[s] = await validateSymbol(s);
      } catch {
        results[s] = null;
      }
    }),
  );
  return c.json({ checked: true, results });
});

api.post('/ocr', async (c) => {
  if (!config().anthropic) return c.json({ error: 'ANTHROPIC_API_KEY が未設定です' }, 400);
  const body = await c.req.json<{ images?: { data: string; mediaType: string }[] }>().catch(() => ({ images: undefined }));
  const images = body.images ?? [];
  if (!Array.isArray(images) || !images.length || images.length > 8) return c.json({ error: '画像は 1〜8 枚にしてください' }, 400);
  try {
    return c.json({ tickers: await readTickersWithClaude(images) });
  } catch (e) {
    console.error(e);
    return c.json({ error: msg(e) || '読み取りに失敗しました' }, 500);
  }
});

api.notFound((c) => c.json({ error: 'not found' }, 404));
