import type { Bar, StockPayload } from '../types';
import { computeTechnicals, type Technicals } from './indicators';

export interface StockState {
  loading: boolean;
  error?: string;
  data?: StockPayload;
}

export interface Derived {
  bars: Bar[];
  price: number | null;
  tech: Technicals | null;
  /** 平均ターゲット価格と現在値の乖離率（%） */
  upside: number | null;
  upsideHigh: number | null;
  upsideLow: number | null;
}

/** 米東部時間の日付（YYYY-MM-DD） */
const etDate = (iso: string) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date(iso));

/** 日足の最後に、最新の現在値を反映する（当日足の更新 or 追加） */
export function withLiveBar(p: StockPayload | undefined): Bar[] {
  const bars = p?.history.data ?? [];
  const q = p?.quote.data;
  if (!bars.length || !q?.time || !q.price) return bars;
  const day = etDate(q.time);
  const last = bars[bars.length - 1];
  if (day < last.time) return bars;
  if (day === last.time) {
    if (last.close === q.price) return bars;
    return [...bars.slice(0, -1), { ...last, close: q.price, high: Math.max(last.high, q.price), low: Math.min(last.low, q.price) }];
  }
  const open = q.previousClose || last.close;
  return [...bars, { time: day, open, high: Math.max(q.dayHigh || q.price, open), low: Math.min(q.dayLow || q.price, open), close: q.price, volume: q.volume ?? 0 }];
}

export function derive(p: StockPayload | undefined): Derived {
  const bars = withLiveBar(p);
  const tech = bars.length >= 30 ? computeTechnicals(bars) : null;
  const price = p?.quote.data?.price ?? bars[bars.length - 1]?.close ?? null;
  const t = p?.target.data;
  const pct = (v: number | null | undefined) => (price && v ? ((v - price) / price) * 100 : null);
  return { bars, price, tech, upside: pct(t?.mean), upsideHigh: pct(t?.high), upsideLow: pct(t?.low) };
}
