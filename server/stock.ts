// 銘柄データの組み立て。取得元の優先順位:
//   現在値            : Yahoo（ほぼリアルタイム）→ FMP
//   日足・目標・決算日 : FMP（キーがある場合）→ Yahoo
import type { DataSource, Quote, Section, StockPayload } from '../src/types.ts';
import * as fmp from './fmp.ts';
import * as yahoo from './yahoo.ts';

const hasFmp = () => !!process.env.FMP_API_KEY;
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

type Source<T> = [DataSource, () => Promise<T>];

/** 上から順に試し、最初に成功したものを返す */
async function firstOf<T>(sources: Source<T>[]): Promise<Section<T>> {
  const errors: string[] = [];
  for (const [source, fn] of sources) {
    try {
      return { data: await fn(), error: null, source };
    } catch (e) {
      errors.push(`${source}: ${msg(e)}`);
    }
  }
  return { data: null, error: errors.join(' / ') || '取得元がありません' };
}

const fmpQuote = async (s: string): Promise<Quote> => ({ ...(await fmp.getQuote(s)), feed: 'FMP' });

export async function fetchStock(symbol: string): Promise<StockPayload> {
  const useFmp = hasFmp();
  const [quote, history, target, earnings] = await Promise.all([
    firstOf<Quote>([['Yahoo', () => yahoo.yahooQuote(symbol)], ...(useFmp ? [['FMP', () => fmpQuote(symbol)] as Source<Quote>] : [])]),
    firstOf([...(useFmp ? [['FMP', () => fmp.getHistory(symbol)] as Source<Awaited<ReturnType<typeof fmp.getHistory>>>] : []), ['Yahoo', () => yahoo.yahooHistory(symbol)]]),
    firstOf([...(useFmp ? [['FMP', () => fmp.getTarget(symbol)] as Source<Awaited<ReturnType<typeof fmp.getTarget>>>] : []), ['Yahoo', () => yahoo.yahooTarget(symbol)]]),
    firstOf([...(useFmp ? [['FMP', () => fmp.getEarnings(symbol)] as Source<Awaited<ReturnType<typeof fmp.getEarnings>>>] : []), ['Yahoo', () => yahoo.yahooEarnings(symbol)]]),
  ]);
  return { symbol, demo: false, fetchedAt: new Date().toISOString(), quote, history, target, earnings };
}

/** 自動更新用: 複数銘柄の現在値だけをまとめて取得 */
export async function fetchQuotes(symbols: string[]): Promise<Record<string, Quote>> {
  let out: Record<string, Quote> = {};
  try {
    out = await yahoo.yahooQuotes(symbols);
  } catch (e) {
    console.warn('Yahoo quotes failed:', msg(e));
  }
  const missing = symbols.filter((s) => !out[s]);
  if (missing.length && hasFmp()) {
    await Promise.all(
      missing.map(async (s) => {
        try {
          out[s] = await fmpQuote(s);
        } catch {
          /* 取得できなかった銘柄は省く */
        }
      }),
    );
  }
  return out;
}
