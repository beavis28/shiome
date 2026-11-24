// Yahoo Finance（非公式 API: yahoo-finance2）からの取得。キー不要・個人利用向け。
// 仕様変更で突然取れなくなることがあるため、呼び出し側で FMP にフォールバックする。
import YahooFinance from 'yahoo-finance2';
import type { Bar, Earnings, HeatItem, NewsItem, PriceTarget, Quote, Valuation } from '../src/types.ts';
import { MAJOR_SECTOR, SECTOR_JA } from './universe.ts';
import { cached, HOUR, MIN } from './cache.ts';

import { AsyncLocalStorage } from 'node:async_hooks';

const newClient = () => new YahooFinance({ suppressNotices: ['yahooSurvey'] });
const shared = newClient();
const perRequest = new AsyncLocalStorage<InstanceType<typeof YahooFinance>>();

/**
 * Workers では、別のリクエストが始めた通信を待つとリクエストが止まる（hung）ため、
 * リクエストごとに Yahoo クライアントを分ける。Node では 1 つを使い回す。
 */
export function withYahooSession<T>(fn: () => T): T {
  return perRequest.run(newClient(), fn);
}
const client = () => perRequest.getStore() ?? shared;

/** 指数・先物・為替など、記号をそのまま渡すときに使う（BRK.B の変換をしない） */
export const yahooRaw = client;

/** Yahoo はクラス株を BRK-B のようにハイフンで表す */
const ySym = (s: string) => s.replace('.', '-');

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : typeof v === 'string' ? v : null);

type RawQuote = Record<string, unknown>;

function toQuote(q: RawQuote): Quote {
  const price = num(q.regularMarketPrice) ?? 0;
  const state = String(q.marketState ?? '');
  const src = String(q.quoteSourceName ?? '');
  const realtime = /real\s*time/i.test(src);
  const delay = num(q.exchangeDataDelayedBy) ?? 0;
  // 時間外の価格（プレ / アフター）
  const isPre = state === 'PRE';
  const ext = isPre ? num(q.preMarketPrice) : state === 'REGULAR' ? null : num(q.postMarketPrice);
  const extPct = isPre ? num(q.preMarketChangePercent) : ext !== null ? num(q.postMarketChangePercent) : null;
  return {
    symbol: String(q.symbol),
    name: String(q.longName ?? q.shortName ?? q.symbol),
    price,
    change: num(q.regularMarketChange) ?? 0,
    changePercent: num(q.regularMarketChangePercent) ?? 0,
    previousClose: num(q.regularMarketPreviousClose) ?? price,
    dayLow: num(q.regularMarketDayLow) ?? price,
    dayHigh: num(q.regularMarketDayHigh) ?? price,
    yearLow: num(q.fiftyTwoWeekLow) ?? price,
    yearHigh: num(q.fiftyTwoWeekHigh) ?? price,
    marketCap: num(q.marketCap),
    volume: num(q.regularMarketVolume),
    exchange: String(q.fullExchangeName ?? q.exchange ?? ''),
    time: iso(q.regularMarketTime),
    marketState: state || null,
    feed: realtime ? `リアルタイム（${src.replace(/\s*Real\s*Time\s*Price/i, '') || 'Yahoo'}）` : delay ? `${delay}分遅延` : 'Yahoo',
    realtime,
    extPrice: ext,
    extChangePercent: extPct,
    extLabel: ext === null ? null : isPre ? 'プレ' : 'アフター',
  };
}

/** 複数銘柄の現在値を 1 回の呼び出しで取得（10 秒キャッシュ） */
export async function yahooQuotes(symbols: string[]): Promise<Record<string, Quote>> {
  const key = [...symbols].sort().join(',');
  return cached(`yf:quotes:${key}`, 10_000, async () => {
    const rows = (await client().quote(symbols.map(ySym), {}, { validateResult: false })) as unknown as RawQuote[];
    const out: Record<string, Quote> = {};
    for (const r of rows ?? []) {
      if (!r || r.regularMarketPrice === undefined) continue;
      const q = toQuote(r);
      const orig = symbols.find((s) => ySym(s) === String(r.symbol).toUpperCase()) ?? q.symbol;
      out[orig] = { ...q, symbol: orig };
    }
    return out;
  });
}

export async function yahooQuote(symbol: string): Promise<Quote> {
  const q = (await yahooQuotes([symbol]))[symbol];
  if (!q) throw new Error('Yahoo に銘柄が見つかりません');
  return q;
}

export function yahooHistory(symbol: string) {
  return cached(`yf:hist:${symbol}`, 6 * HOUR, async (): Promise<Bar[]> => {
    type Row = { date: string | Date; open: number | null; high: number | null; low: number | null; close: number | null; volume: number | null };
    const c = (await client().chart(ySym(symbol), { period1: new Date(Date.now() - 600 * 86400_000), interval: '1d' }, { validateResult: false })) as { quotes?: Row[] };
    const bars = (c.quotes ?? [])
      .filter((b) => num(b.close) !== null && num(b.open) !== null)
      .map((b) => ({
        time: new Date(b.date).toISOString().slice(0, 10),
        open: +b.open!.toFixed(4),
        high: +b.high!.toFixed(4),
        low: +b.low!.toFixed(4),
        close: +b.close!.toFixed(4),
        volume: b.volume ?? 0,
      }));
    if (!bars.length) throw new Error('Yahoo に価格履歴がありません');
    return bars;
  });
}

function summary(symbol: string) {
  return cached(`yf:summary3:${symbol}`, 12 * HOUR, async () => {
    const s = await client().quoteSummary(
      ySym(symbol),
      { modules: ['financialData', 'calendarEvents', 'summaryDetail', 'defaultKeyStatistics', 'price', 'assetProfile'] },
      { validateResult: false },
    );
    return JSON.parse(JSON.stringify(s)) as {
      financialData?: Record<string, unknown>;
      calendarEvents?: { earnings?: Record<string, unknown> };
      summaryDetail?: Record<string, unknown>;
      defaultKeyStatistics?: Record<string, unknown>;
      price?: Record<string, unknown>;
      assetProfile?: Record<string, unknown>;
    };
  });
}

export async function yahooTarget(symbol: string): Promise<PriceTarget> {
  const fd = (await summary(symbol)).financialData;
  const mean = num(fd?.targetMeanPrice);
  if (mean === null) throw new Error('ターゲット価格のデータがありません');
  return {
    mean,
    median: num(fd?.targetMedianPrice),
    high: num(fd?.targetHighPrice),
    low: num(fd?.targetLowPrice),
    analysts: num(fd?.numberOfAnalystOpinions),
  };
}

export async function yahooEarnings(symbol: string): Promise<Earnings> {
  const e = (await summary(symbol)).calendarEvents?.earnings;
  const dates = ((e?.earningsDate as string[] | undefined) ?? []).map((d) => String(d).slice(0, 10)).sort();
  const today = new Date().toISOString().slice(0, 10);
  return {
    date: dates.find((d) => d >= today) ?? null,
    epsEstimated: num(e?.earningsAverage),
    revenueEstimated: num(e?.revenueAverage),
    lastDate: null,
    estimate: e?.isEarningsDateEstimate === true,
  };
}

/** 比較用の指標（PER・PSR・時価総額など）。quoteSummary を目標価格・決算日と共有（12 時間キャッシュ） */
export async function yahooValuation(symbol: string): Promise<Valuation> {
  const s = await summary(symbol);
  const sd = s.summaryDetail ?? {};
  const ks = s.defaultKeyStatistics ?? {};
  const fd = s.financialData ?? {};
  const pr = s.price ?? {};
  return {
    symbol,
    name: (pr.shortName as string | undefined) ?? (pr.longName as string | undefined) ?? null,
    marketCap: num(sd.marketCap) ?? num(pr.marketCap),
    trailingPE: num(sd.trailingPE),
    forwardPE: num(sd.forwardPE) ?? num(ks.forwardPE),
    psr: num(sd.priceToSalesTrailing12Months),
    pbr: num(ks.priceToBook),
    evToEbitda: num(ks.enterpriseToEbitda),
    peg: num(ks.pegRatio),
    dividendYield: num(sd.dividendYield),
    revenueGrowth: num(fd.revenueGrowth),
    profitMargin: num(fd.profitMargins) ?? num(ks.profitMargins),
    operatingMargin: num(fd.operatingMargins),
    roe: num(fd.returnOnEquity),
    beta: num(sd.beta) ?? num(ks.beta),
    source: 'Yahoo',
  };
}

/** ヒートマップ用: 多数の銘柄の時価総額と変化率をまとめて取得（60 秒キャッシュ） */
export async function yahooHeatmap(symbols: string[]): Promise<{ items: HeatItem[]; missing: string[] }> {
  const key = [...symbols].sort().join(',');
  return cached(`yf:heat:${key}`, 60_000, async () => {
    const rows: RawQuote[] = [];
    for (let i = 0; i < symbols.length; i += 60) {
      const part = symbols.slice(i, i + 60);
      rows.push(...((await client().quote(part.map(ySym), {}, { validateResult: false })) as unknown as RawQuote[]));
    }
    const bySym = new Map(rows.filter(Boolean).map((r) => [String(r.symbol).toUpperCase(), r]));
    const items: HeatItem[] = [];
    const missing: string[] = [];
    for (const s of symbols) {
      const r = bySym.get(ySym(s));
      const cap = num(r?.marketCap);
      if (!r || !cap) {
        missing.push(s);
        continue;
      }
      let sector = MAJOR_SECTOR[s];
      if (!sector) {
        try {
          sector = String((await summary(s)).assetProfile?.sector ?? '');
        } catch {
          sector = '';
        }
      }
      items.push({
        symbol: s,
        name: String(r.shortName ?? r.longName ?? s),
        sector: SECTOR_JA[sector] ?? (sector || 'その他'),
        marketCap: cap,
        price: num(r.regularMarketPrice) ?? 0,
        change1d: num(r.regularMarketChangePercent),
        vs50d: num(r.fiftyDayAverageChangePercent) !== null ? num(r.fiftyDayAverageChangePercent)! * 100 : null,
        change52w: num(r.fiftyTwoWeekChangePercent),
      });
    }
    return { items, missing };
  });
}

/** 銘柄に関するニュース（10 分キャッシュ） */
export function yahooNews(symbol: string) {
  return cached(`yf:news:${symbol}`, 10 * MIN, async (): Promise<NewsItem[]> => {
    const r = (await client().search(ySym(symbol), { newsCount: 20, quotesCount: 0 }, { validateResult: false })) as { news?: Record<string, unknown>[] };
    const items: NewsItem[] = (r.news ?? []).map((raw) => {
      const thumbs = (raw.thumbnail as { resolutions?: { url: string; width: number }[] } | undefined)?.resolutions ?? [];
      const small = [...thumbs].sort((a, b) => a.width - b.width).find((t) => t.width >= 100) ?? thumbs[0];
      return {
        id: String(raw.uuid ?? raw.link),
        title: String(raw.title ?? ''),
        publisher: String(raw.publisher ?? ''),
        link: String(raw.link ?? ''),
        time: iso(raw.providerPublishTime) ?? new Date().toISOString(),
        related: ((raw.relatedTickers as string[] | undefined) ?? []).filter((t) => !t.startsWith('^')).map((t) => t.replace('-', '.')),
        thumbnail: small?.url ?? null,
      };
    });
    // その銘柄に関連付けられた記事を優先して並べる
    const direct = items.filter((n) => n.related.includes(symbol));
    const other = items.filter((n) => !n.related.includes(symbol));
    return [...direct, ...other].filter((n) => n.title && /^https:\/\//.test(n.link)).slice(0, 15);
  });
}
