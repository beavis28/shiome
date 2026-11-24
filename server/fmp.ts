// Financial Modeling Prep (stable API) からのデータ取得
import type { Bar, Earnings, PriceTarget, Quote } from '../src/types.ts';
import { cached, HOUR, MIN } from './cache.ts';

const BASE = 'https://financialmodelingprep.com/stable';

class FmpError extends Error {}

async function fmp<T>(endpoint: string, params: Record<string, string>): Promise<T> {
  const key = process.env.FMP_API_KEY;
  if (!key) throw new FmpError('FMP_API_KEY が未設定です');
  const qs = new URLSearchParams({ ...params, apikey: key });
  const res = await fetch(`${BASE}/${endpoint}?${qs}`);
  const text = await res.text();
  if (!res.ok) {
    if (res.status === 402 || /premium|subscription|plan/i.test(text)) {
      throw new FmpError('現在の FMP プランでは取得できません');
    }
    if (res.status === 429) throw new FmpError('FMP の呼び出し上限に達しました');
    throw new FmpError(`FMP エラー (${res.status})`);
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new FmpError('FMP の応答を解析できません');
  }
  if (json && typeof json === 'object' && !Array.isArray(json) && 'Error Message' in json) {
    const msg = String((json as Record<string, unknown>)['Error Message']);
    throw new FmpError(/premium|subscription|plan/i.test(msg) ? '現在の FMP プランでは取得できません' : msg);
  }
  return json as T;
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

export function getQuote(symbol: string) {
  return cached(`fmp:quote:${symbol}`, 2 * MIN, async (): Promise<Quote> => {
    const rows = await fmp<Record<string, unknown>[]>('quote', { symbol });
    const q = rows?.[0];
    if (!q) throw new FmpError('銘柄が見つかりません');
    const price = num(q.price) ?? 0;
    return {
      symbol,
      name: String(q.name ?? symbol),
      price,
      change: num(q.change) ?? 0,
      changePercent: num(q.changePercentage) ?? num(q.changesPercentage) ?? 0,
      previousClose: num(q.previousClose) ?? price,
      dayLow: num(q.dayLow) ?? price,
      dayHigh: num(q.dayHigh) ?? price,
      yearLow: num(q.yearLow) ?? price,
      yearHigh: num(q.yearHigh) ?? price,
      marketCap: num(q.marketCap),
      volume: num(q.volume),
      exchange: String(q.exchange ?? ''),
    };
  });
}

export function getHistory(symbol: string) {
  return cached(`fmp:hist:${symbol}`, 6 * HOUR, async (): Promise<Bar[]> => {
    const from = new Date(Date.now() - 600 * 86400_000).toISOString().slice(0, 10);
    const raw = await fmp<unknown>('historical-price-eod/full', { symbol, from });
    const rows = (Array.isArray(raw) ? raw : ((raw as { historical?: unknown[] })?.historical ?? [])) as Record<string, unknown>[];
    const bars = rows
      .map((r) => ({
        time: String(r.date).slice(0, 10),
        open: num(r.open) ?? 0,
        high: num(r.high) ?? 0,
        low: num(r.low) ?? 0,
        close: num(r.close) ?? 0,
        volume: num(r.volume) ?? 0,
      }))
      .filter((b) => b.close > 0)
      .sort((a, b) => a.time.localeCompare(b.time));
    if (!bars.length) throw new FmpError('価格履歴がありません');
    return bars;
  });
}

export function getTarget(symbol: string) {
  return cached(`fmp:target:${symbol}`, 12 * HOUR, async (): Promise<PriceTarget> => {
    const rows = await fmp<Record<string, unknown>[]>('price-target-consensus', { symbol });
    const t = rows?.[0];
    if (!t) throw new FmpError('ターゲット価格のデータがありません');
    return {
      mean: num(t.targetConsensus),
      median: num(t.targetMedian),
      high: num(t.targetHigh),
      low: num(t.targetLow),
    };
  });
}

export function getEarnings(symbol: string) {
  return cached(`fmp:earn:${symbol}`, 12 * HOUR, async (): Promise<Earnings> => {
    const rows = await fmp<Record<string, unknown>[]>('earnings', { symbol, limit: '12' });
    const today = new Date().toISOString().slice(0, 10);
    const list = (rows ?? [])
      .map((r) => ({ date: String(r.date).slice(0, 10), eps: num(r.epsEstimated), rev: num(r.revenueEstimated) }))
      .sort((a, b) => a.date.localeCompare(b.date));
    const next = list.find((r) => r.date >= today) ?? null;
    const last = [...list].reverse().find((r) => r.date < today) ?? null;
    return {
      date: next?.date ?? null,
      epsEstimated: next?.eps ?? null,
      revenueEstimated: next?.rev ?? null,
      lastDate: last?.date ?? null,
    };
  });
}

/** 読み取ったティッカーが実在するか確認（7日キャッシュ） */
export function validateSymbol(symbol: string) {
  return cached(`fmp:search:${symbol}`, 7 * 24 * HOUR, async () => {
    const rows = await fmp<Record<string, unknown>[]>('search-symbol', { query: symbol, limit: '10' });
    const hit = (rows ?? []).find((r) => String(r.symbol).toUpperCase() === symbol);
    return hit ? { symbol, name: String(hit.name ?? ''), exchange: String(hit.exchange ?? '') } : null;
  });
}
