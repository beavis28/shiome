// 金利・商品・為替・株価指数など、株価に影響する市場全体の指標
//  - 現在値と前日比: Yahoo Finance（まとめて 1 回で取得、60 秒キャッシュ）
//  - 約 3 か月の推移: Yahoo の日足（1 時間キャッシュ）
//  - 2 年債・FF 金利・10年-2年差: FRED（6 時間キャッシュ。FRED_API_KEY がある場合のみ）
import { fredFetch } from './fred.ts';
import { tx } from './lang.ts';
import type { Indicator, MacroGroup, MacroItem, MacroPayload } from '../src/types.ts';
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
    key: 'world',
    label: '世界の株価指数',
    items: [
      { id: '^N225', label: '日経平均', unit: 'index', decimals: 2 },
      { id: '^HSI', label: '香港ハンセン', unit: 'index', decimals: 2 },
      { id: '000001.SS', label: '上海総合', unit: 'index', decimals: 2 },
      { id: '^KS11', label: '韓国 KOSPI', unit: 'index', decimals: 2 },
      { id: '^TWII', label: '台湾加権', unit: 'index', decimals: 2, note: '半導体（TSMC）の比重が大きい' },
      { id: '^BSESN', label: 'インド SENSEX', unit: 'index', decimals: 2 },
      { id: '^GDAXI', label: 'ドイツ DAX', unit: 'index', decimals: 2 },
      { id: '^STOXX50E', label: 'ユーロ・ストックス50', unit: 'index', decimals: 2 },
      { id: '^FTSE', label: '英国 FTSE100', unit: 'index', decimals: 2 },
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
    const res = await fredFetch(`https://api.stlouisfed.org/fred/series/observations?${qs}`);
    if (!res.ok) throw new Error(tx(`FRED エラー (${res.status})`, `FRED error (${res.status})`));
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

// 米国の主な経済指標（FRED）。units は FRED の変換: pc1=前年比 %, chg=前回からの増減, pch=前月比 %
const INDICATORS: { id: string; label: string; units: string; unit: Indicator['unit']; decimals: number; freq: Indicator['freq']; nextKey?: string; note?: string }[] = [
  { id: 'CPIAUCSL', label: 'CPI（前年比）', units: 'pc1', unit: '%', decimals: 1, freq: 'M', nextKey: 'CPI', note: '消費者物価指数。インフレの代表的な指標' },
  { id: 'CPILFESL', label: 'コア CPI（前年比）', units: 'pc1', unit: '%', decimals: 1, freq: 'M', nextKey: 'CPI', note: '食品とエネルギーを除いた CPI' },
  { id: 'PCEPILFE', label: 'コア PCE（前年比）', units: 'pc1', unit: '%', decimals: 1, freq: 'M', nextKey: 'PCE', note: 'FRB が物価目標（2%）に使う指標' },
  { id: 'T10YIE', label: '期待インフレ率（10年）', units: 'lin', unit: '%', decimals: 2, freq: 'D', note: '市場が予想する今後 10 年の平均インフレ率（ブレークイーブン）' },
  { id: 'UNRATE', label: '失業率', units: 'lin', unit: '%', decimals: 1, freq: 'M', nextKey: 'NFP' },
  { id: 'PAYEMS', label: '非農業部門雇用者数（増減）', units: 'chg', unit: 'k', decimals: 0, freq: 'M', nextKey: 'NFP', note: '前月からの雇用の増減（千人）' },
  { id: 'ICSA', label: '新規失業保険申請件数', units: 'lin', unit: 'k', decimals: 0, freq: 'W', note: '毎週木曜発表。増えると雇用の悪化を示す' },
  { id: 'A191RL1Q225SBEA', label: '実質 GDP 成長率（年率）', units: 'lin', unit: '%', decimals: 1, freq: 'Q', nextKey: 'GDP', note: '前期比・年率換算' },
  { id: 'RSAFS', label: '小売売上高（前月比）', units: 'pch', unit: '%', decimals: 1, freq: 'M', nextKey: 'RETAIL' },
  { id: 'UMCSENT', label: 'ミシガン大消費者信頼感', units: 'lin', unit: 'num', decimals: 1, freq: 'M', note: '消費者の景気の見方。高いほど楽観的' },
];

async function fetchIndicators(key: string, warnings: string[]): Promise<Indicator[]> {
  const start = new Date(Date.now() - 3 * 365 * 86400_000).toISOString().slice(0, 10);
  const res = await Promise.allSettled(
    INDICATORS.map((d) =>
      cached(`macro:ind:${d.id}:${d.units}`, 6 * HOUR, async () => {
        const qs = new URLSearchParams({ series_id: d.id, api_key: key, file_type: 'json', units: d.units, observation_start: start, sort_order: 'asc' });
        const r = await fredFetch(`https://api.stlouisfed.org/fred/series/observations?${qs}`);
        if (!r.ok) throw new Error(tx(`FRED エラー (${r.status})`, `FRED error (${r.status})`));
        const j = (await r.json()) as { observations?: { date: string; value: string }[] };
        let obs = (j.observations ?? []).filter((o) => o.value !== '.').map((o) => [o.date, Number(o.value)] as [string, number]);
        if (d.id === 'ICSA') obs = obs.map(([t, v]) => [t, v / 1000] as [string, number]); // 千件
        if (d.freq === 'D') obs = obs.filter((_, k, a) => k % 5 === 0 || k === a.length - 1); // 日次は間引く
        return obs;
      }).then((obs) => {
        const last = obs[obs.length - 1];
        const prev = obs[obs.length - 2];
        return {
          id: d.id,
          label: d.label,
          value: last?.[1] ?? null,
          prev: prev?.[1] ?? null,
          unit: d.unit,
          decimals: d.decimals,
          date: last?.[0] ?? null,
          freq: d.freq,
          spark: obs.slice(-36),
          nextKey: d.nextKey,
          note: d.note,
        } satisfies Indicator;
      }),
    ),
  );
  const out = res.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []));
  if (out.length < INDICATORS.length) warnings.push(tx('FRED の経済指標を一部取得できませんでした', 'Some FRED indicators could not be loaded'));
  return out;
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
          state: r.marketState ? String(r.marketState) : null,
        },
      ]),
    );
  }).catch((e) => {
    warnings.push(`Yahoo: ${e instanceof Error ? e.message : e}`);
    return {} as Record<string, { price: number | null; change: number | null; changePct: number | null; time: string | null; state: string | null }>;
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
        state: q?.state ?? null,
      };
    }),
  }));

  const key = process.env.FRED_API_KEY;
  if (key) {
    const fred = await Promise.allSettled(FRED_SERIES.map((d) => fredSeries(d, key)));
    const rates = groups.find((g) => g.key === 'rates')!;
    const extra = fred.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []));
    if (extra.length < FRED_SERIES.length) warnings.push(tx('FRED の金利データを一部取得できませんでした', 'Some FRED rate series could not be loaded'));
    // 政策金利 → 3か月 → 2年 → 5年 → 10年 → 30年 → 10年-2年 の順に並べる
    const by = Object.fromEntries([...rates.items, ...extra].map((i) => [i.id, i]));
    rates.items = ['DFF', '^IRX', 'DGS2', '^FVX', '^TNX', '^TYX', 'T10Y2Y'].map((id) => by[id]).filter(Boolean);
  } else {
    warnings.push(tx('FRED_API_KEY が未設定のため、2 年債・FF 金利・10年-2年差は表示されません', 'FRED_API_KEY is not set, so the 2Y yield, fed funds and 10Y-2Y spread are hidden'));
  }

  const indicators = key ? await fetchIndicators(key, warnings) : [];
  return { groups, indicators, warnings, asOf: new Date().toISOString() };
}
