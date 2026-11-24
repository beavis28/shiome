// 金利・商品・為替・株価指数など、株価に影響する市場全体の指標
//  - 現在値と前日比: Yahoo Finance（まとめて 1 回で取得、60 秒キャッシュ）
//  - 約 3 か月の推移: Yahoo の日足（1 時間キャッシュ）
//  - 2 年債・FF 金利・10年-2年差: FRED（6 時間キャッシュ。FRED_API_KEY がある場合のみ）
import type { MacroGroup, MacroItem, MacroPayload } from '../src/types.ts';
import { cached, HOUR } from './cache.ts';
import { yahooRaw } from './yahoo.ts';

type Def = { id: string; label: string; unit: MacroItem['unit']; decimals: number; note?: string };

const YAHOO_GROUPS: { key: string; label: string; items: Def[] }[] = [
  {
    key: 'index',
    label: '株価指数',
    items: [
      { id: '^GSPC', label: 'S&P 500', unit: 'index', decimals: 2 },
      { id: '^IXIC', label: 'ナスダック総合', unit: 'index', decimals: 2 },
      { id: '^DJI', label: 'ダウ平均', unit: 'index', decimals: 2 },
      { id: '^RUT', label: 'ラッセル2000', unit: 'index', decimals: 2, note: '米小型株' },
      { id: '^VIX', label: 'VIX', unit: 'pt', decimals: 2, note: '恐怖指数。20 を超えると不安が強いとされる' },
    ],
  },
  {
    key: 'rates',
    label: '米国の金利',
    items: [
      { id: '^IRX', label: '米3か月', unit: 'yield', decimals: 3 },
      { id: '^FVX', label: '米5年', unit: 'yield', decimals: 3 },
      { id: '^TNX', label: '米10年', unit: 'yield', decimals: 3, note: '住宅ローンや株のバリュエーションに影響する長期金利' },
      { id: '^TYX', label: '米30年', unit: 'yield', decimals: 3 },
    ],
  },
  {
    key: 'commodities',
    label: '商品',
    items: [
      { id: 'CL=F', label: 'WTI原油', unit: 'usd', decimals: 2, note: '先物・1 バレルあたり米ドル' },
      { id: 'BZ=F', label: 'ブレント原油', unit: 'usd', decimals: 2, note: '先物・1 バレルあたり米ドル' },
      { id: 'NG=F', label: '天然ガス', unit: 'usd', decimals: 3, note: '先物・MMBtu あたり米ドル' },
      { id: 'GC=F', label: '金', unit: 'usd', decimals: 1, note: '先物・1 トロイオンスあたり米ドル' },
      { id: 'SI=F', label: '銀', unit: 'usd', decimals: 3, note: '先物・1 トロイオンスあたり米ドル' },
      { id: 'HG=F', label: '銅', unit: 'usd', decimals: 4, note: '先物・1 ポンドあたり米ドル。景気の先行指標とされる' },
    ],
  },
  {
    key: 'fx',
    label: '為替',
    items: [
      { id: 'DX-Y.NYB', label: 'ドル指数', unit: 'index', decimals: 3, note: '主要 6 通貨に対するドルの強さ' },
      { id: 'USDJPY=X', label: 'ドル円', unit: 'fx', decimals: 3 },
      { id: 'EURUSD=X', label: 'ユーロドル', unit: 'fx', decimals: 4 },
      { id: 'USDCNY=X', label: 'ドル人民元', unit: 'fx', decimals: 4 },
    ],
  },
  {
    key: 'crypto',
    label: '暗号資産',
    items: [
      { id: 'BTC-USD', label: 'ビットコイン', unit: 'usd', decimals: 0 },
      { id: 'ETH-USD', label: 'イーサリアム', unit: 'usd', decimals: 1 },
    ],
  },
];

const FRED_SERIES: Def[] = [
  { id: 'DFF', label: 'FF金利（実効）', unit: 'yield', decimals: 2, note: 'FRB の政策金利の実際の水準（FRED・前営業日）' },
  { id: 'DGS2', label: '米2年', unit: 'yield', decimals: 2, note: '政策金利の見通しを映しやすい（FRED・前営業日）' },
  { id: 'T10Y2Y', label: '10年−2年', unit: 'yield', decimals: 2, note: 'マイナス（逆イールド）は景気後退の前触れとされる（FRED）' },
];

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : typeof v === 'string' ? v : null);

function spark(id: string) {
  return cached(`macro:spark:${id}`, HOUR, async () => {
    const c = (await yahooRaw().chart(id, { period1: new Date(Date.now() - 95 * 86400_000), interval: '1d' }, { validateResult: false })) as {
      quotes?: { date: string | Date; close: number | null }[];
    };
    return (c.quotes ?? [])
      .filter((q) => num(q.close) !== null)
      .map((q) => [new Date(q.date).toISOString().slice(0, 10), +(q.close as number).toFixed(4)] as [string, number]);
  });
}

async function fredSeries(def: Def, key: string): Promise<MacroItem> {
  const obs = await cached(`macro:fred:${def.id}`, 6 * HOUR, async () => {
    const start = new Date(Date.now() - 100 * 86400_000).toISOString().slice(0, 10);
    const qs = new URLSearchParams({ series_id: def.id, api_key: key, file_type: 'json', observation_start: start, sort_order: 'asc' });
    const res = await fetch(`https://api.stlouisfed.org/fred/series/observations?${qs}`);
    if (!res.ok) throw new Error(`FRED エラー (${res.status})`);
    const j = (await res.json()) as { observations?: { date: string; value: string }[] };
    return (j.observations ?? []).filter((o) => o.value !== '.').map((o) => [o.date, Number(o.value)] as [string, number]);
  });
  const last = obs[obs.length - 1];
  const prev = obs[obs.length - 2];
  return {
    id: def.id,
    label: def.label,
    value: last ? last[1] : null,
    change: last && prev ? +(last[1] - prev[1]).toFixed(4) : null,
    changePct: null,
    unit: def.unit,
    decimals: def.decimals,
    spark: obs,
    asOf: last ? last[0] : null,
    source: 'FRED',
    note: def.note,
  };
}

export async function fetchMacro(): Promise<MacroPayload> {
  const warnings: string[] = [];
  const defs = YAHOO_GROUPS.flatMap((g) => g.items);
  const quotes = await cached('macro:quotes', 60_000, async () => {
    const rows = (await yahooRaw().quote(
      defs.map((d) => d.id),
      {},
      { validateResult: false },
    )) as unknown as Record<string, unknown>[];
    return Object.fromEntries(
      rows.filter(Boolean).map((r) => [
        String(r.symbol),
        {
          price: num(r.regularMarketPrice),
          change: num(r.regularMarketChange),
          changePct: num(r.regularMarketChangePercent),
          time: iso(r.regularMarketTime),
        },
      ]),
    );
  }).catch((e) => {
    warnings.push(`Yahoo: ${e instanceof Error ? e.message : e}`);
    return {} as Record<string, { price: number | null; change: number | null; changePct: number | null; time: string | null }>;
  });

  const sparks = await Promise.all(defs.map((d) => spark(d.id).catch(() => [] as [string, number][])));
  const sparkOf = Object.fromEntries(defs.map((d, i) => [d.id, sparks[i]]));

  const groups: MacroGroup[] = YAHOO_GROUPS.map((g) => ({
    key: g.key,
    label: g.label,
    items: g.items.map((d) => {
      const q = quotes[d.id];
      return {
        id: d.id,
        label: d.label,
        value: q?.price ?? null,
        change: q?.change ?? null,
        changePct: d.unit === 'yield' ? null : (q?.changePct ?? null),
        unit: d.unit,
        decimals: d.decimals,
        spark: sparkOf[d.id] ?? [],
        asOf: q?.time ?? null,
        source: 'Yahoo' as const,
        note: d.note,
      };
    }),
  }));

  const key = process.env.FRED_API_KEY;
  if (key) {
    const fred = await Promise.allSettled(FRED_SERIES.map((d) => fredSeries(d, key)));
    const rates = groups.find((g) => g.key === 'rates')!;
    const extra = fred.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []));
    if (extra.length < FRED_SERIES.length) warnings.push('FRED の金利データを一部取得できませんでした');
    // 政策金利 → 3か月 → 2年 → 5年 → 10年 → 30年 → 10年-2年 の順に並べる
    const by = Object.fromEntries([...rates.items, ...extra].map((i) => [i.id, i]));
    rates.items = ['DFF', '^IRX', 'DGS2', '^FVX', '^TNX', '^TYX', 'T10Y2Y'].map((id) => by[id]).filter(Boolean);
  } else {
    warnings.push('FRED_API_KEY が未設定のため、2 年債・FF 金利・10年-2年差は表示されません');
  }

  return { groups, warnings, asOf: new Date().toISOString() };
}
