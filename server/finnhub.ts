// Finnhub（無料プラン）: 市場全体の決算・IPO・休場日、同業他社、役員の売買センチメント
// リアルタイム株価の配信は server/hub.ts。無料プランは 1 分 60 回までなので、どれも長めにキャッシュする
import type { InsiderSentiment, MarketCalendar } from '../src/types.ts';
import { cached, HOUR } from './cache.ts';
import { tx } from './lang.ts';
import { MAJOR_SYMBOLS } from './universe.ts';

async function fh<T>(endpoint: string, params: Record<string, string>): Promise<T> {
  const key = process.env.FINNHUB_API_KEY;
  if (!key) throw new Error(tx('FINNHUB_API_KEY が未設定です', 'FINNHUB_API_KEY is not set'));
  const res = await fetch(`https://finnhub.io/api/v1/${endpoint}?${new URLSearchParams({ ...params, token: key })}`, {
    signal: AbortSignal.timeout(10_000),
  });
  if (res.status === 401) throw new Error(tx('FINNHUB_API_KEY が正しくありません', 'FINNHUB_API_KEY is invalid'));
  if (res.status === 403) throw new Error(tx('現在の Finnhub プランでは取得できません', 'Not available on your Finnhub plan'));
  if (res.status === 429) throw new Error(tx('Finnhub の呼び出し上限に達しました', 'Finnhub rate limit reached'));
  if (!res.ok) throw new Error(`Finnhub ${res.status}`);
  return (await res.json()) as T;
}

const day = (offset: number) => new Date(Date.now() + offset * 86400_000).toISOString().slice(0, 10);
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const MAJOR = new Set(MAJOR_SYMBOLS);

/** 市場全体の決算（主要銘柄・売上の大きい会社）、IPO、休場日（6 時間キャッシュ） */
export function marketCalendar(): Promise<MarketCalendar> {
  return cached(`fh:cal:v2:${day(0)}`, 6 * HOUR, async () => {
    const [e, i, h] = await Promise.allSettled([
      fh<{ earningsCalendar?: Record<string, unknown>[] }>('calendar/earnings', { from: day(0), to: day(21) }),
      fh<{ ipoCalendar?: Record<string, unknown>[] }>('calendar/ipo', { from: day(0), to: day(60) }),
      fh<{ data?: Record<string, unknown>[] }>('stock/market-holiday', { exchange: 'US' }),
    ]);
    const earnings =
      e.status === 'fulfilled'
        ? (e.value.earningsCalendar ?? [])
            .map((r) => ({
              symbol: String(r.symbol ?? '').replace('-', '.'),
              date: String(r.date ?? ''),
              hour: String(r.hour ?? ''), // bmo = 寄り前, amc = 引け後
              epsEstimate: num(r.epsEstimate),
              revenueEstimate: num(r.revenueEstimate),
            }))
            // 主要米国株（ヒートマップと同じ約 120 銘柄）だけ。売上の予想は海外企業だと現地通貨で、大きさの比較に使えない
            .filter((r) => r.symbol && r.date && MAJOR.has(r.symbol))
            .sort((a, b) => a.date.localeCompare(b.date) || (b.revenueEstimate ?? 0) - (a.revenueEstimate ?? 0))
            .slice(0, 80)
        : [];
    const ipos =
      i.status === 'fulfilled'
        ? (i.value.ipoCalendar ?? []).map((r) => ({
            symbol: String(r.symbol ?? ''),
            name: String(r.name ?? ''),
            date: String(r.date ?? ''),
            exchange: String(r.exchange ?? ''),
            price: String(r.price ?? ''),
            status: String(r.status ?? ''),
            value: num(r.totalSharesValue),
          }))
        : [];
    const holidays =
      h.status === 'fulfilled'
        ? (h.value.data ?? [])
            .map((r) => ({ name: String(r.eventName ?? ''), date: String(r.atDate ?? ''), hours: String(r.tradingHour ?? '') }))
            .filter((r) => r.date >= day(-1) && r.date <= day(400))
            .sort((a, b) => a.date.localeCompare(b.date))
        : [];
    const errors = [e, i, h].filter((r) => r.status === 'rejected').map((r) => String((r as PromiseRejectedResult).reason?.message ?? r));
    return { earnings, ipos, holidays, errors: [...new Set(errors)] };
  });
}

/** 同業他社（7 日キャッシュ）。最初の要素は本人なので除く */
export function peers(symbol: string): Promise<string[]> {
  return cached(`fh:peers:${symbol}`, 7 * 24 * HOUR, async () => {
    const list = await fh<string[]>('stock/peers', { symbol });
    return [...new Set((Array.isArray(list) ? list : []).map((s) => String(s).replace('-', '.')))].filter((s) => s !== symbol && /^[A-Z]{1,5}(\.[A-Z]{1,2})?$/.test(s));
  });
}

/** 役員の売買センチメント（MSPR）。月ごと、直近 2 年（1 日キャッシュ） */
export function insiderSentiment(symbol: string): Promise<InsiderSentiment> {
  return cached(`fh:mspr:${symbol}:${day(0)}`, 24 * HOUR, async () => {
    const r = await fh<{ data?: Record<string, unknown>[] }>('stock/insider-sentiment', { symbol, from: day(-730), to: day(0) });
    const months = (r.data ?? [])
      .map((d) => ({ month: `${d.year}-${String(d.month).padStart(2, '0')}`, mspr: num(d.mspr) ?? 0, change: num(d.change) ?? 0 }))
      .sort((a, b) => a.month.localeCompare(b.month));
    return { symbol, months };
  });
}
