import { useState, type ReactNode } from 'react';
import type { MacroItem, MacroPayload } from '../types';
import { Card, changeColor } from './ui';

export function fmtMacroValue(i: MacroItem) {
  if (i.value === null) return '—';
  const n = i.value.toLocaleString('en-US', { minimumFractionDigits: i.decimals, maximumFractionDigits: i.decimals });
  if (i.unit === 'yield') return `${n}%`;
  if (i.unit === 'usd') return `$${n}`;
  return n;
}

/** 前日比。金利は bp（0.01%pt）、それ以外は % */
export function fmtMacroChange(i: MacroItem) {
  if (i.unit === 'yield') {
    if (i.change === null) return '—';
    const bp = i.change * 100;
    return `${bp > 0 ? '+' : bp < 0 ? '−' : '±'}${Math.abs(bp).toFixed(1)}bp`;
  }
  if (i.changePct === null) return '—';
  return `${i.changePct > 0 ? '+' : i.changePct < 0 ? '−' : '±'}${Math.abs(i.changePct).toFixed(2)}%`;
}

const changeOf = (i: MacroItem) => (i.unit === 'yield' ? i.change : i.changePct);

/** 約 3 か月の推移。マウスを乗せると日付と値を表示 */
function Sparkline({ item }: { item: MacroItem }) {
  const [hi, setHi] = useState<number | null>(null);
  const pts = item.spark;
  const W = 84;
  const H = 24;
  if (pts.length < 2) return <span className="inline-block w-[84px] text-center text-[10px] text-mute">—</span>;
  const vs = pts.map((p) => p[1]);
  const lo = Math.min(...vs);
  const hiV = Math.max(...vs);
  const x = (k: number) => (k / (pts.length - 1)) * (W - 4) + 2;
  const y = (v: number) => H - 3 - ((v - lo) / (hiV - lo || 1)) * (H - 6);
  const d = pts.map((p, k) => `${k ? 'L' : 'M'}${x(k).toFixed(1)},${y(p[1]).toFixed(1)}`).join('');
  const cur = hi ?? pts.length - 1;
  return (
    <span className="relative inline-block">
      <svg
        width={W}
        height={H}
        className="block"
        onMouseMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          setHi(Math.max(0, Math.min(pts.length - 1, Math.round(((e.clientX - r.left - 2) / (W - 4)) * (pts.length - 1)))));
        }}
        onMouseLeave={() => setHi(null)}
        role="img"
        aria-label={`${item.label} の約 3 か月の推移`}
      >
        <path d={d} fill="none" stroke="#60a5fa" strokeWidth="1.5" strokeLinejoin="round" />
        {hi !== null && <line x1={x(cur)} x2={x(cur)} y1={0} y2={H} stroke="rgba(255,255,255,.25)" />}
        <circle cx={x(cur)} cy={y(pts[cur][1])} r="2.5" fill="#60a5fa" stroke="#121826" strokeWidth="1.5" />
      </svg>
      {hi !== null && (
        <span className="num pointer-events-none absolute -top-5 right-0 z-10 whitespace-nowrap rounded bg-bg/95 px-1.5 text-[10px] ring-1 ring-line">
          {pts[cur][0].slice(5).replace('-', '/')} {pts[cur][1].toLocaleString('en-US', { maximumFractionDigits: item.decimals })}
          {item.unit === 'yield' ? '%' : ''}
        </span>
      )}
    </span>
  );
}

/** 利回り曲線: 今日と約 3 か月前 */
function YieldCurve({ items }: { items: MacroItem[] }) {
  const order: [string, string][] = [
    ['^IRX', '3か月'],
    ['DGS2', '2年'],
    ['^FVX', '5年'],
    ['^TNX', '10年'],
    ['^TYX', '30年'],
  ];
  type Pt = { label: string; now: number; before: number | null };
  const pts: Pt[] = order.flatMap(([id, label]) => {
    const it = items.find((i) => i.id === id);
    return it && it.value !== null ? [{ label, now: it.value, before: it.spark[0]?.[1] ?? null }] : [];
  });
  if (pts.length < 3) return null;
  const all = pts.flatMap((p) => [p.now, p.before ?? p.now]);
  const lo = Math.floor(Math.min(...all) * 4) / 4;
  const hi = Math.ceil(Math.max(...all) * 4) / 4;
  const W = 320;
  const H = 96;
  const L = 34;
  const x = (k: number) => L + (k / (pts.length - 1)) * (W - L - 12);
  const y = (v: number) => 8 + (1 - (v - lo) / (hi - lo || 1)) * (H - 26);
  const path = (get: (p: Pt) => number | null) =>
    pts
      .map((p, k) => (get(p) === null ? '' : `${k ? 'L' : 'M'}${x(k).toFixed(1)},${y(get(p)!).toFixed(1)}`))
      .join('');
  const ticks = [lo, (lo + hi) / 2, hi];
  return (
    <div className="px-3 pb-2">
      <div className="mb-1 flex items-center gap-3 text-[10px] text-mute">
        <span className="font-semibold">利回り曲線</span>
        <span className="flex items-center gap-1">
          <i className="inline-block h-0.5 w-3 bg-[#60a5fa]" />今日
        </span>
        <span className="flex items-center gap-1">
          <i className="inline-block h-0 w-3 border-t border-dashed border-slate-400" />約3か月前
        </span>
      </div>
      <svg width="100%" viewBox={`0 0 ${W} ${H}`} className="block" role="img" aria-label="米国債の利回り曲線">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={L} x2={W - 8} y1={y(t)} y2={y(t)} stroke="rgba(255,255,255,.07)" />
            <text x={L - 4} y={y(t) + 3} textAnchor="end" fontSize="9" fill="#8b97ae">
              {t.toFixed(2)}%
            </text>
          </g>
        ))}
        <path d={path((p) => p.before)} fill="none" stroke="#94a3b8" strokeWidth="1.5" strokeDasharray="4 3" />
        <path d={path((p) => p.now)} fill="none" stroke="#60a5fa" strokeWidth="2" />
        {pts.map((p, k) => (
          <g key={p.label}>
            <circle cx={x(k)} cy={y(p.now)} r="3" fill="#60a5fa" stroke="#121826" strokeWidth="1.5">
              <title>{`${p.label}: ${p.now.toFixed(2)}%（3か月前 ${p.before?.toFixed(2) ?? '—'}%）`}</title>
            </circle>
            <text x={x(k)} y={H - 4} textAnchor="middle" fontSize="9" fill="#8b97ae">
              {p.label}
            </text>
          </g>
        ))}
      </svg>
    </div>
  );
}

function Group({ label, items, children }: { label: string; items: MacroItem[]; children?: ReactNode }) {
  return (
    <Card title={label} right={<span className="text-[10px] text-mute">前日比 · 約3か月</span>}>
      <div className="divide-y divide-line/50">
        {items.map((i) => (
          <div key={i.id} className="flex items-center gap-2 px-3 py-0.5">
            <span className="min-w-0 flex-1 truncate text-xs" title={i.note ? `${i.label}: ${i.note}` : i.label}>
              {i.label}
              {i.note && <span className="ml-0.5 text-[9px] text-mute">ⓘ</span>}
            </span>
            <span className="num w-[5.5rem] shrink-0 text-right text-xs font-semibold">{fmtMacroValue(i)}</span>
            <span className={`num w-16 shrink-0 text-right text-[11px] ${changeColor(changeOf(i))}`}>{fmtMacroChange(i)}</span>
            <span className="shrink-0">
              <Sparkline item={i} />
            </span>
          </div>
        ))}
      </div>
      {children}
    </Card>
  );
}

export function MacroView({ macro, error }: { macro: MacroPayload | null; error: string | null }) {
  if (!macro) {
    return <Card className="flex h-full items-center justify-center text-sm text-mute">{error ?? '読み込み中…'}</Card>;
  }
  const g = (k: string) => macro.groups.find((x) => x.key === k);
  const rates = g('rates');
  return (
    <div className="h-full min-h-0 overflow-auto">
      {macro.warnings.map((w) => (
        <p key={w} className="mb-2 rounded bg-warnc/10 px-2 py-1 text-[11px] text-warnc">
          {w}
        </p>
      ))}
      <div className="grid grid-cols-2 gap-2">
        <div className="flex flex-col gap-2">
          {g('index') && <Group label={g('index')!.label} items={g('index')!.items} />}
          {g('commodities') && <Group label={g('commodities')!.label} items={g('commodities')!.items} />}
        </div>
        <div className="flex flex-col gap-2">
          {rates && (
            <Group label={rates.label} items={rates.items}>
              <YieldCurve items={rates.items} />
            </Group>
          )}
          {g('fx') && <Group label={g('fx')!.label} items={g('fx')!.items} />}
          {g('crypto') && <Group label={g('crypto')!.label} items={g('crypto')!.items} />}
        </div>
      </div>
      <p className="mt-2 px-1 text-[10px] text-mute">
        金利の前日比は bp（0.01%）。商品は先物の期近。Yahoo Finance と FRED のデータで、遅延を含む場合があります。{new Date(macro.asOf).toLocaleTimeString('ja-JP')} 更新
      </p>
    </div>
  );
}

/** ヘッダー下に常に出す、市場全体の要約 */
const STRIP = ['^GSPC', '^IXIC', '^VIX', '^TNX', 'DGS2', 'CL=F', 'GC=F', 'USDJPY=X', 'DX-Y.NYB', 'BTC-USD'];

export function MarketStrip({ macro, onOpen }: { macro: MacroPayload | null; onOpen: () => void }) {
  if (!macro) return null;
  const all = macro.groups.flatMap((g) => g.items);
  const items = STRIP.map((id) => all.find((i) => i.id === id)).filter((i): i is MacroItem => !!i && i.value !== null);
  return (
    <button
      type="button"
      onClick={onOpen}
      title="クリックで金利・商品・為替の詳細を表示"
      className="flex w-full items-center gap-4 overflow-hidden whitespace-nowrap border-b border-line bg-panel/40 px-4 py-1 text-left text-[11px] hover:bg-panel/70"
    >
      {items.map((i) => (
        <span key={i.id} className="flex items-baseline gap-1.5">
          <span className="text-mute">{i.label}</span>
          <span className="num">{fmtMacroValue(i)}</span>
          <span className={`num ${changeColor(changeOf(i))}`}>{fmtMacroChange(i)}</span>
        </span>
      ))}
    </button>
  );
}
