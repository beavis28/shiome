import { useState, type ReactNode } from 'react';
import type { EconPayload, Indicator, MacroItem, MacroPayload } from '../types';
import { Card, changeColor } from './ui';
import { useT } from '../lib/i18n';
import { groupLabel, indicatorLabel, indicatorNote, macroLabel, macroNote } from '../lib/names';

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
  const { t, lang } = useT();
  const name = macroLabel(item, lang);
  return <Spark pts={item.spark} decimals={item.decimals} suffix={item.unit === 'yield' ? '%' : ''} label={t(`${name} の約 3 か月の推移`, `${name}, ~3-month trend`)} />;
}

export function Spark({ pts, decimals, suffix, label, width = 84 }: { pts: [string, number][]; decimals: number; suffix: string; label: string; width?: number }) {
  const [hi, setHi] = useState<number | null>(null);
  const W = width;
  const H = 24;
  if (pts.length < 2) return <span className="inline-block text-center text-[10px] text-mute" style={{ width: W }}>—</span>;
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
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        height={H}
        className={`block ${W === 84 ? 'w-[52px] md:w-[84px]' : ''}`}
        style={W === 84 ? undefined : { width: W }}
        onMouseMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          setHi(Math.max(0, Math.min(pts.length - 1, Math.round(((e.clientX - r.left) / r.width) * (pts.length - 1)))));
        }}
        onMouseLeave={() => setHi(null)}
        role="img"
        aria-label={label}
      >
        <path d={d} fill="none" stroke="#60a5fa" strokeWidth="1.5" strokeLinejoin="round" />
        {hi !== null && <line x1={x(cur)} x2={x(cur)} y1={0} y2={H} stroke="rgba(255,255,255,.25)" />}
        <circle cx={x(cur)} cy={y(pts[cur][1])} r="2.5" fill="#60a5fa" stroke="#121826" strokeWidth="1.5" />
      </svg>
      {hi !== null && (
        <span className="num pointer-events-none absolute -top-5 right-0 z-10 whitespace-nowrap rounded bg-bg/95 px-1.5 text-[10px] ring-1 ring-line">
          {pts[cur][0].slice(2).replaceAll('-', '/')}{' '}
          {pts[cur][1].toLocaleString('en-US', { maximumFractionDigits: decimals })}
          {suffix}
        </span>
      )}
    </span>
  );
}

/** 利回り曲線: 今日と約 3 か月前 */
function YieldCurve({ items }: { items: MacroItem[] }) {
  const { t } = useT();
  const order: [string, string][] = [
    ['^IRX', t('3か月', '3M')],
    ['DGS2', t('2年', '2Y')],
    ['^FVX', t('5年', '5Y')],
    ['^TNX', t('10年', '10Y')],
    ['^TYX', t('30年', '30Y')],
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
        <span className="font-semibold">{t('利回り曲線', 'Yield curve')}</span>
        <span className="flex items-center gap-1">
          <i className="inline-block h-0.5 w-3 bg-[#60a5fa]" />{t('今日', 'Today')}
        </span>
        <span className="flex items-center gap-1">
          <i className="inline-block h-0 w-3 border-t border-dashed border-slate-400" />{t('約3か月前', '~3 months ago')}
        </span>
      </div>
      <svg width="100%" viewBox={`0 0 ${W} ${H}`} className="block" role="img" aria-label={t('米国債の利回り曲線', 'US Treasury yield curve')}>
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
              <title>{t(`${p.label}: ${p.now.toFixed(2)}%（3か月前 ${p.before?.toFixed(2) ?? '—'}%）`, `${p.label}: ${p.now.toFixed(2)}% (3 mo ago ${p.before?.toFixed(2) ?? '—'}%)`)}</title>
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
  const { t, lang } = useT();
  return (
    <Card title={label} right={<span className="text-[10px] text-mute">{t('前日比 · 約3か月', 'Day chg · ~3 mo')}</span>}>
      <div className="divide-y divide-line/50">
        {items.map((i) => {
          const name = macroLabel(i, lang);
          const note = macroNote(i, lang);
          return (
          <div key={i.id} className="flex items-center gap-2 px-3 py-0.5">
            <span className="min-w-0 flex-1 truncate text-xs" title={note ? `${name}: ${note}` : name}>
              {i.state === 'REGULAR' && <span className="mr-1 inline-block h-1.5 w-1.5 rounded-full bg-upc align-middle" title={t('取引中', 'Trading')} />}
              {name}
              {note && <span className="ml-0.5 text-[9px] text-mute">ⓘ</span>}
            </span>
            <span className="num w-[4.75rem] shrink-0 text-right text-xs font-semibold md:w-[5.5rem]">{fmtMacroValue(i)}</span>
            <span className={`num w-14 shrink-0 text-right text-[11px] md:w-16 ${changeColor(changeOf(i))}`}>{fmtMacroChange(i)}</span>
            <span className="shrink-0">
              <Sparkline item={i} />
            </span>
          </div>
          );
        })}
      </div>
      {children}
    </Card>
  );
}

const pad = (n: number) => String(n).padStart(2, '0');
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function periodLabel(i: Indicator, t: (ja: string, en: string) => string) {
  if (!i.date) return '—';
  const [y, m, d] = i.date.split('-').map(Number);
  if (i.freq === 'Q') return t(`${y}年${m}-${m + 2}月期`, `Q${Math.ceil(m / 3)} ${y}`);
  if (i.freq === 'M') return t(`${y}年${m}月`, `${MON[m - 1]} ${y}`);
  if (i.freq === 'W') return t(`${m}/${pad(d)} 週`, `Wk of ${m}/${pad(d)}`);
  return `${m}/${pad(d)}`;
}
function fmtInd(i: Indicator, v: number | null, signed = false, t: (ja: string, en: string) => string = (ja) => ja) {
  if (v === null || !Number.isFinite(v)) return '—';
  const sign = signed || i.id === 'PAYEMS' ? (v > 0 ? '+' : v < 0 ? '−' : '±') : v < 0 ? '−' : '';
  const n = Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: i.decimals, maximumFractionDigits: i.decimals });
  if (i.unit === '%') return `${sign}${n}${signed ? 'pt' : '%'}`;
  if (i.unit === 'k') return `${sign}${n}${i.id === 'ICSA' ? t('千件', 'K') : t('千人', 'K')}`;
  return `${sign}${n}`;
}

function Indicators({ items, econ }: { items: Indicator[]; econ: EconPayload | null }) {
  const today = new Date().toISOString().slice(0, 10);
  const next = (key?: string) => (key ? econ?.events.find((e) => e.key === key && e.date >= today)?.date : undefined);
  const { t, lang } = useT();
  return (
    <Card title={t('米国の経済指標（最新の発表）', 'US economic data (latest releases)')} right={<span className="text-[10px] text-mute">{t('FRED · 推移は約3年', 'FRED · ~3-yr trend')}</span>}>
      <div className="overflow-x-auto">
      <table className="w-full min-w-[560px] text-xs">
        <thead className="text-[10px] text-mute">
          <tr className="border-b border-line">
            <th className="px-3 py-1 text-left font-medium">{t('指標', 'Indicator')}</th>
            <th className="px-2 py-1 text-right font-medium">{t('最新', 'Latest')}</th>
            <th className="px-2 py-1 text-right font-medium">{t('前回から', 'Change')}</th>
            <th className="px-2 py-1 text-left font-medium">{t('対象期間', 'Period')}</th>
            <th className="px-2 py-1 text-left font-medium">{t('次回発表', 'Next release')}</th>
            <th className="px-3 py-1 text-right font-medium">{t('推移', 'Trend')}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line/50">
          {items.map((i) => {
            const diff = i.value !== null && i.prev !== null ? i.value - i.prev : null;
            const n = next(i.nextKey);
            const name = indicatorLabel(i, lang);
            const note = indicatorNote(i, lang);
            return (
              <tr key={i.id}>
                <td className="px-3 py-0.5" title={note}>
                  {name}
                  {note && <span className="ml-0.5 text-[9px] text-mute">ⓘ</span>}
                </td>
                <td className="num px-2 py-0.5 text-right font-semibold">{fmtInd(i, i.value, false, t)}</td>
                <td className="num px-2 py-0.5 text-right text-mute">
                  {diff === null ? '—' : `${diff > 0 ? '▲' : diff < 0 ? '▼' : ''} ${fmtInd(i, diff, true, t)}`}
                </td>
                <td className="num px-2 py-0.5 text-mute">{periodLabel(i, t)}</td>
                <td className="num px-2 py-0.5 text-mute">{n ? `${Number(n.slice(5, 7))}/${Number(n.slice(8))}` : i.freq === 'W' ? t('毎週木曜', 'Thursdays') : i.freq === 'D' ? t('毎日', 'Daily') : '—'}</td>
                <td className="px-3 py-0.5 text-right">
                  <Spark pts={i.spark} decimals={i.decimals} suffix={i.unit === '%' ? '%' : ''} label={t(`${name} の推移`, `${name} trend`)} width={110} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      </div>
    </Card>
  );
}

export function MacroView({ macro, error, econ }: { macro: MacroPayload | null; error: string | null; econ: EconPayload | null }) {
  const { t, lang } = useT();
  if (!macro) {
    return <Card className="flex h-full items-center justify-center text-sm text-mute">{error ?? t('読み込み中…', 'Loading…')}</Card>;
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
      <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
        <div className="flex flex-col gap-2">
          {g('index') && <Group label={groupLabel(g('index')!, lang)} items={g('index')!.items} />}
          {g('world') && <Group label={groupLabel(g('world')!, lang)} items={g('world')!.items} />}
          {g('fx') && <Group label={groupLabel(g('fx')!, lang)} items={g('fx')!.items} />}
        </div>
        <div className="flex flex-col gap-2">
          {rates && (
            <Group label={groupLabel(rates, lang)} items={rates.items}>
              <YieldCurve items={rates.items} />
            </Group>
          )}
          {g('commodities') && <Group label={groupLabel(g('commodities')!, lang)} items={g('commodities')!.items} />}
          {g('crypto') && <Group label={groupLabel(g('crypto')!, lang)} items={g('crypto')!.items} />}
        </div>
      </div>
      {macro.indicators.length > 0 && (
        <div className="mt-2">
          <Indicators items={macro.indicators} econ={econ} />
        </div>
      )}
      <p className="mt-2 px-1 text-[10px] text-mute">
        {t(
          `金利の前日比は bp（0.01%）。商品は先物の期近。● は取引中の市場。Yahoo Finance と FRED のデータで、遅延を含む場合があります。${new Date(macro.asOf).toLocaleTimeString('ja-JP')} 更新`,
          `Rate changes are in bp (0.01%). Commodities are front-month futures. ● = market open. Data from Yahoo Finance and FRED; may be delayed. Updated ${new Date(macro.asOf).toLocaleTimeString('en-US')}`,
        )}
      </p>
    </div>
  );
}

/** ヘッダー下に常に出す、市場全体の要約 */
const STRIP = ['^GSPC', '^IXIC', '^VIX', '^TNX', 'DGS2', 'CL=F', 'GC=F', 'USDJPY=X', 'DX-Y.NYB', 'BTC-USD'];

export function MarketStrip({ macro, onOpen }: { macro: MacroPayload | null; onOpen: () => void }) {
  const { t, lang } = useT();
  if (!macro) return null;
  const all = macro.groups.flatMap((g) => g.items);
  const items = STRIP.map((id) => all.find((i) => i.id === id)).filter((i): i is MacroItem => !!i && i.value !== null);
  return (
    <button
      type="button"
      onClick={onOpen}
      title={t('クリックで金利・商品・為替の詳細を表示', 'Click for rates, commodities and FX details')}
      className="flex w-full items-center gap-4 overflow-x-auto whitespace-nowrap border-b border-line bg-panel/40 px-4 py-1 text-left text-[11px] hover:bg-panel/70 [scrollbar-width:none]"
    >
      {items.map((i) => (
        <span key={i.id} className="flex items-baseline gap-1.5">
          <span className="text-mute">{macroLabel(i, lang)}</span>
          <span className="num">{fmtMacroValue(i)}</span>
          <span className={`num ${changeColor(changeOf(i))}`}>{fmtMacroChange(i)}</span>
        </span>
      ))}
    </button>
  );
}
