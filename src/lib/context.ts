// 相談チャットに渡す「いま画面に出ている情報」をまとめる
import type { EconPayload, NewsItem } from '../types';
import type { Derived, StockState } from './derive';
import { daysUntil } from './format';

const r2 = (v: number | null | undefined) => (v === null || v === undefined || !Number.isFinite(v) ? null : Math.round(v * 100) / 100);

function pctChange(closes: number[], back: number) {
  if (closes.length <= back) return null;
  const a = closes[closes.length - 1 - back];
  const b = closes[closes.length - 1];
  return r2(((b - a) / a) * 100);
}

export function buildDashboardContext(opts: {
  selected: string | null;
  symbols: string[];
  states: Record<string, StockState>;
  derived: Record<string, Derived>;
  econ: EconPayload | null;
  news: NewsItem[];
  marketState: string | null;
}) {
  const { selected, symbols, states, derived, econ, news, marketState } = opts;
  const watchlist = symbols.map((s) => {
    const p = states[s]?.data;
    const d = derived[s];
    return {
      symbol: s,
      name: p?.quote.data?.name ?? null,
      price: r2(d?.price),
      changePct: r2(p?.quote.data?.changePercent),
      targetUpsidePct: r2(d?.upside),
      rsi14: r2(d?.tech?.last.rsi),
      nextEarnings: p?.earnings.data?.date ?? null,
    };
  });

  let detail: Record<string, unknown> | null = null;
  if (selected) {
    const p = states[selected]?.data;
    const d = derived[selected];
    const closes = d?.bars.map((b) => b.close) ?? [];
    detail = p
      ? {
          symbol: selected,
          quote: p.quote.data && {
            ...p.quote.data,
            source: p.quote.source,
          },
          analystTarget: p.target.data && { ...p.target.data, upsideToMeanPct: r2(d?.upside), source: p.target.source },
          earnings: p.earnings.data && { ...p.earnings.data, daysUntil: daysUntil(p.earnings.data.date), source: p.earnings.source },
          performancePct: {
            '1w': pctChange(closes, 5),
            '1m': pctChange(closes, 21),
            '3m': pctChange(closes, 63),
            '6m': pctChange(closes, 126),
            '1y': pctChange(closes, 252),
          },
          technicals: d?.tech && {
            rsi14: r2(d.tech.last.rsi),
            macd: r2(d.tech.last.macd),
            macdSignal: r2(d.tech.last.macdSignal),
            bollingerPercentB: r2(d.tech.last.percentB),
            sma50: r2(d.tech.last.sma50),
            sma200: r2(d.tech.last.sma200),
            signals: d.tech.signals.map((s) => `${s.label}: ${s.value}`),
          },
          recentDailyCloses: d?.bars.slice(-30).map((b) => [b.time, r2(b.close)]),
          news: news.slice(0, 10).map((n) => ({ title: n.title, publisher: n.publisher, time: n.time, related: n.related.slice(0, 5) })),
        }
      : null;
  }

  const upcomingEconomicEvents = (econ?.events ?? [])
    .filter((e) => {
      const d = daysUntil(e.date);
      return d !== null && d >= 0 && d <= 45;
    })
    .map((e) => ({ date: e.date, timeET: e.timeET, event: e.label, importance: e.importance }));

  return {
    asOf: new Date().toISOString(),
    usMarketState: marketState,
    selected: detail,
    watchlist,
    upcomingEconomicEvents,
    notes: econ?.warnings ?? [],
  };
}
