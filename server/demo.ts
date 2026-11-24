// FMP_API_KEY 未設定時に画面確認用の「デモデータ」を生成する（実在の値ではない）
import type { Bar, StockPayload } from '../src/types.ts';

function hash(s: string) {
  let h = 2166136261;
  for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return h >>> 0;
}

function rng(seed: number) {
  let a = seed || 1;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ymd = (d: Date) => d.toISOString().slice(0, 10);

export function demoStock(symbol: string): StockPayload {
  const h = hash(symbol);
  const r = rng(h);
  const gauss = () => Math.sqrt(-2 * Math.log(r() + 1e-12)) * Math.cos(2 * Math.PI * r());
  let price = 20 + (h % 380);
  const drift = ((h % 7) - 2) / 4000;
  const vol = 0.012 + (h % 13) / 1000;

  const bars: Bar[] = [];
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 560);
  const end = new Date();
  while (d <= end) {
    const dow = d.getUTCDay();
    if (dow !== 0 && dow !== 6) {
      const open = price * (1 + gauss() * vol * 0.3);
      const close = open * (1 + drift + gauss() * vol);
      const high = Math.max(open, close) * (1 + Math.abs(gauss()) * vol * 0.5);
      const low = Math.min(open, close) * (1 - Math.abs(gauss()) * vol * 0.5);
      bars.push({
        time: ymd(d),
        open: +open.toFixed(2),
        high: +high.toFixed(2),
        low: +low.toFixed(2),
        close: +close.toFixed(2),
        volume: Math.round(5e6 + r() * 2e7),
      });
      price = close;
    }
    d.setUTCDate(d.getUTCDate() + 1);
  }

  const last = bars[bars.length - 1];
  const prev = bars[bars.length - 2];
  const year = bars.slice(-252);
  const mean = last.close * (1 + ((h % 35) - 8) / 100);
  const earn = new Date();
  earn.setUTCDate(earn.getUTCDate() + 3 + (h % 70));
  if (earn.getUTCDay() === 0) earn.setUTCDate(earn.getUTCDate() + 1);
  if (earn.getUTCDay() === 6) earn.setUTCDate(earn.getUTCDate() + 2);

  return {
    symbol,
    demo: true,
    fetchedAt: new Date().toISOString(),
    quote: {
      data: {
        symbol,
        name: `${symbol}（デモ）`,
        price: last.close,
        change: +(last.close - prev.close).toFixed(2),
        changePercent: +(((last.close - prev.close) / prev.close) * 100).toFixed(2),
        previousClose: prev.close,
        dayLow: last.low,
        dayHigh: last.high,
        yearLow: Math.min(...year.map((b) => b.low)),
        yearHigh: Math.max(...year.map((b) => b.high)),
        marketCap: null,
        volume: last.volume,
        exchange: 'DEMO',
      },
      error: null,
    },
    history: { data: bars, error: null },
    target: {
      data: {
        mean: +mean.toFixed(2),
        median: +(mean * 1.01).toFixed(2),
        high: +(mean * (1.25 + (h % 10) / 100)).toFixed(2),
        low: +(mean * (0.7 - (h % 8) / 100)).toFixed(2),
      },
      error: null,
    },
    earnings: {
      data: { date: ymd(earn), epsEstimated: +(0.5 + (h % 300) / 100).toFixed(2), revenueEstimated: null, lastDate: null },
      error: null,
    },
  };
}
