// 予測市場 Kalshi での FOMC の結果の確率（キー不要の公開データ）。https://kalshi.com/markets/kxfeddecision
import type { FedMeeting } from '../src/types.ts';
import { cached, MIN } from './cache.ts';

const n = (v: unknown) => {
  const x = typeof v === 'string' ? Number(v) : typeof v === 'number' ? v : NaN;
  return Number.isFinite(x) ? x : null;
};

/** 直近の会合ごとの確率（15 分キャッシュ）。買値と売値の中間、なければ直近の約定価格を使い、合計 100% にそろえる */
export function fedOdds(): Promise<{ meetings: FedMeeting[]; asOf: string }> {
  return cached('kalshi:fed:v1', 15 * MIN, async () => {
    const res = await fetch('https://api.elections.kalshi.com/trade-api/v2/events?series_ticker=KXFEDDECISION&status=open&with_nested_markets=true&limit=6', {
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) throw new Error(`Kalshi ${res.status}`);
    const d = (await res.json()) as { events?: { event_ticker: string; strike_date?: string; markets?: Record<string, unknown>[] }[] };
    const meetings: FedMeeting[] = [];
    for (const e of d.events ?? []) {
      if (!e.strike_date) continue;
      const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date(e.strike_date));
      const outcomes = (e.markets ?? []).flatMap((m) => {
        const bid = n(m.yes_bid_dollars);
        const ask = n(m.yes_ask_dollars);
        const last = n(m.last_price_dollars);
        const p = bid !== null && ask !== null && ask > 0 ? (bid + ask) / 2 : last;
        return p === null ? [] : [{ key: String(m.ticker).split('-').pop() ?? '', label: String(m.yes_sub_title ?? m.subtitle ?? ''), prob: p }];
      });
      const total = outcomes.reduce((a, o) => a + o.prob, 0);
      if (!total) continue;
      meetings.push({
        date,
        outcomes: outcomes.map((o) => ({ ...o, prob: o.prob / total })),
        url: `https://kalshi.com/markets/kxfeddecision`,
      });
    }
    return { meetings: meetings.sort((a, b) => a.date.localeCompare(b.date)), asOf: new Date().toISOString() };
  });
}
