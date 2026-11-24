import { useMemo, useRef, useState } from 'react';
import type { Valuation } from '../types';
import { fmtBig } from '../lib/format';
import { Card } from './ui';

// 色はデータの「正・負」だけを表す（暗い背景で検証済み: dataviz validate_palette.js）
const POS = '#3b82f6';
const NEG = '#d97706';

type Kind = 'ratio' | 'pct' | 'usd';
export interface Metric {
  key: keyof Valuation;
  label: string;
  short: string;
  kind: Kind;
  hint: string;
  group: string;
}

export const METRICS: Metric[] = [
  { key: 'forwardPE', label: 'PER（予想）', short: '予想PER', kind: 'ratio', group: '割安・割高', hint: '株価 ÷ 予想 EPS。今後 12 か月の予想利益に対して何倍か' },
  { key: 'trailingPE', label: 'PER（実績）', short: 'PER', kind: 'ratio', group: '割安・割高', hint: '株価 ÷ 直近 12 か月の EPS。赤字の場合は表示されません' },
  { key: 'psr', label: 'PSR', short: 'PSR', kind: 'ratio', group: '割安・割高', hint: '時価総額 ÷ 直近 12 か月の売上高' },
  { key: 'pbr', label: 'PBR', short: 'PBR', kind: 'ratio', group: '割安・割高', hint: '株価 ÷ 1 株あたり純資産' },
  { key: 'evToEbitda', label: 'EV/EBITDA', short: 'EV/EBITDA', kind: 'ratio', group: '割安・割高', hint: '企業価値 ÷ EBITDA（利払い・税・償却前利益）' },
  { key: 'peg', label: 'PEG レシオ', short: 'PEG', kind: 'ratio', group: '割安・割高', hint: 'PER ÷ 利益成長率。成長を考慮した PER' },
  { key: 'marketCap', label: '時価総額', short: '時価総額', kind: 'usd', group: '規模', hint: '株価 × 発行済株式数（米ドル）' },
  { key: 'revenueGrowth', label: '売上成長率', short: '売上成長', kind: 'pct', group: '成長・収益性', hint: '直近四半期の売上高の前年同期比' },
  { key: 'profitMargin', label: '純利益率', short: '純利益率', kind: 'pct', group: '成長・収益性', hint: '純利益 ÷ 売上高（直近 12 か月）' },
  { key: 'operatingMargin', label: '営業利益率', short: '営業利益率', kind: 'pct', group: '成長・収益性', hint: '営業利益 ÷ 売上高（直近 12 か月）' },
  { key: 'roe', label: 'ROE', short: 'ROE', kind: 'pct', group: '成長・収益性', hint: '純利益 ÷ 自己資本' },
  { key: 'dividendYield', label: '配当利回り', short: '配当', kind: 'pct', group: 'その他', hint: '年間配当 ÷ 株価' },
  { key: 'beta', label: 'ベータ', short: 'β', kind: 'ratio', group: 'その他', hint: '市場全体（S&P 500）に対する値動きの大きさ。1 より大きいほど変動が大きい' },
];

export const DEFAULT_METRICS: (keyof Valuation)[] = ['forwardPE', 'psr', 'marketCap', 'revenueGrowth'];

export function fmtMetric(v: number | null | undefined, kind: Kind) {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  if (kind === 'usd') return `$${fmtBig(v)}`;
  if (kind === 'pct') return `${v < 0 ? '−' : ''}${Math.abs(v * 100).toFixed(1)}%`;
  return `${v < 0 ? '−' : ''}${Math.abs(v).toFixed(Math.abs(v) >= 100 ? 0 : 1)}${'倍'}`;
}

function median(xs: number[]) {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** 1 指標を横棒で比べる。0 を基準に左右へ伸ばし、中央値の線を引く */
function BarChart({ metric, rows, focus, onFocus }: { metric: Metric; rows: Valuation[]; focus: string | null; onFocus: (s: string) => void }) {
  const [hover, setHover] = useState<{ sym: string; x: number; y: number } | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const items = rows
    .map((r) => ({ sym: r.symbol, name: r.name, v: r[metric.key] as number | null }))
    .sort((a, b) => (b.v ?? -Infinity) - (a.v ?? -Infinity));
  const vals = items.map((i) => i.v).filter((v): v is number => v !== null && Number.isFinite(v));
  const lo = Math.min(0, ...vals);
  const hi = Math.max(0, ...vals);
  const span = hi - lo || 1;
  const pos = (v: number) => ((v - lo) / span) * 100;
  const zero = pos(0);
  const med = median(vals);
  const hovered = hover && items.find((i) => i.sym === hover.sym);

  return (
    <Card className="flex min-h-0 flex-col" title={<span title={metric.hint}>{metric.label}</span>} right={med !== null && <span className="num text-[10px] text-mute">中央値 {fmtMetric(med, metric.kind)}</span>}>
      <div ref={boxRef} className="relative min-h-0 flex-1 overflow-auto px-3 py-2" onMouseLeave={() => setHover(null)}>
        <div className="relative">
          {/* 中央値の線（目立たせない） */}
          {med !== null && (
            <div className="pointer-events-none absolute bottom-0 top-0 z-0 border-l border-dashed border-white/25" style={{ left: `calc(56px + (100% - 56px - 64px) * ${pos(med) / 100})` }} />
          )}
          {items.map((it) => {
            const has = it.v !== null && Number.isFinite(it.v);
            const v = it.v ?? 0;
            const left = Math.min(pos(v), zero);
            const width = Math.abs(pos(v) - zero);
            const neg = v < 0;
            return (
              <div
                key={it.sym}
                className="relative z-10 flex h-[18px] cursor-pointer items-center"
                onClick={() => onFocus(it.sym)}
                onMouseMove={(e) => {
                  const b = boxRef.current?.getBoundingClientRect();
                  if (b) setHover({ sym: it.sym, x: e.clientX - b.left + (boxRef.current?.scrollLeft ?? 0), y: e.clientY - b.top + (boxRef.current?.scrollTop ?? 0) });
                }}
              >
                <span className={`w-14 shrink-0 truncate text-[11px] font-semibold ${it.sym === focus ? 'text-accent' : 'text-ink'}`}>{it.sym}</span>
                <div className="relative h-full flex-1">
                  {/* 0 の基準線 */}
                  <div className="absolute bottom-0 top-0 w-px bg-white/20" style={{ left: `${zero}%` }} />
                  {has && (
                    <div
                      className="absolute top-[4px] h-2.5"
                      style={{
                        left: `${left}%`,
                        width: `max(${width}%, 2px)`,
                        background: neg ? NEG : POS,
                        borderRadius: neg ? '4px 0 0 4px' : '0 4px 4px 0',
                        opacity: hover && hover.sym !== it.sym ? 0.55 : 1,
                      }}
                    />
                  )}
                </div>
                <span className="num w-16 shrink-0 text-right text-[11px] text-mute">{has ? fmtMetric(v, metric.kind) : 'データなし'}</span>
              </div>
            );
          })}
        </div>
        {hovered && hover && (
          <div
            className="pointer-events-none absolute z-20 rounded-md border border-line bg-bg/95 px-2 py-1 text-[11px] shadow-lg"
            style={{ left: Math.min(hover.x + 12, (boxRef.current?.clientWidth ?? 300) - 170), top: hover.y + 10 }}
          >
            <div className="font-semibold">
              {hovered.sym} <span className="font-normal text-mute">{hovered.name}</span>
            </div>
            <div className="num">
              {metric.label}: <span className="font-semibold">{fmtMetric(hovered.v, metric.kind)}</span>
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}

interface Props {
  symbols: string[];
  data: Record<string, Valuation>;
  errors: Record<string, string>;
  loading: boolean;
  focus: string | null;
  onFocus: (s: string) => void;
  metrics: (keyof Valuation)[];
  onMetrics: (m: (keyof Valuation)[]) => void;
}

export function CompareView({ symbols, data, errors, loading, focus, onFocus, metrics, onMetrics }: Props) {
  const rows = useMemo(() => symbols.map((s) => data[s]).filter(Boolean), [symbols, data]);
  const [sortKey, setSortKey] = useState<keyof Valuation | null>(null);
  const tableRows = useMemo(
    () => (sortKey ? [...rows].sort((a, b) => ((b[sortKey] as number | null) ?? -Infinity) - ((a[sortKey] as number | null) ?? -Infinity)) : rows),
    [rows, sortKey],
  );
  const chosen = metrics.map((k) => METRICS.find((m) => m.key === k)!).filter(Boolean);
  const toggle = (k: keyof Valuation) =>
    onMetrics(metrics.includes(k) ? metrics.filter((x) => x !== k) : metrics.length >= 4 ? [...metrics.slice(1), k] : [...metrics, k]);

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      {/* 指標の選択（最大 4 つ） */}
      <Card className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3 py-2">
        <span className="text-xs font-semibold text-mute">グラフにする指標（最大 4）</span>
        {[...new Set(METRICS.map((m) => m.group))].map((g) => (
          <span key={g} className="flex flex-wrap items-center gap-1">
            <span className="text-[10px] text-mute">{g}</span>
            {METRICS.filter((m) => m.group === g).map((m) => {
              const on = metrics.includes(m.key);
              return (
                <button
                  key={m.key}
                  title={m.hint}
                  aria-pressed={on}
                  onClick={() => toggle(m.key)}
                  className={`rounded-full border px-2 py-0.5 text-[11px] ${on ? 'border-accent bg-accent/15 text-accent' : 'border-line text-mute hover:text-ink'}`}
                >
                  {m.short}
                </button>
              );
            })}
          </span>
        ))}
        <span className="ml-auto text-[10px] text-mute">{loading ? '読み込み中…' : `${rows.length} 銘柄 · Yahoo Finance`}</span>
      </Card>

      {!symbols.length ? (
        <Card className="flex flex-1 items-center justify-center text-sm text-mute">左のウォッチリストで、比べたい銘柄にチェックを入れてください</Card>
      ) : (
        <>
          <div className={`grid min-h-0 flex-[3] gap-2 ${chosen.length > 1 ? 'grid-cols-2' : 'grid-cols-1'} ${chosen.length > 2 ? 'grid-rows-2' : 'grid-rows-1'}`}>
            {chosen.map((m) => (
              <BarChart key={m.key} metric={m} rows={rows} focus={focus} onFocus={onFocus} />
            ))}
          </div>

          {/* 全指標の表（グラフの元データ） */}
          <Card className="flex min-h-0 flex-[2] flex-col" title="指標の一覧" right={<span className="text-[10px] text-mute">見出しをクリックで並べ替え</span>}>
            <div className="min-h-0 flex-1 overflow-auto">
              <table className="w-full text-[11px]">
                <thead className="sticky top-0 bg-panel text-mute">
                  <tr>
                    <th className="px-2 py-1 text-left font-medium">銘柄</th>
                    {METRICS.map((m) => (
                      <th
                        key={m.key}
                        title={m.hint}
                        onClick={() => setSortKey(sortKey === m.key ? null : m.key)}
                        className={`cursor-pointer whitespace-nowrap px-2 py-1 text-right font-medium hover:text-ink ${sortKey === m.key ? 'text-accent' : ''}`}
                      >
                        {m.short}
                        {sortKey === m.key ? ' ▼' : ''}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {tableRows.map((r) => (
                    <tr key={r.symbol} onClick={() => onFocus(r.symbol)} className={`cursor-pointer border-t border-line/50 hover:bg-white/[0.03] ${r.symbol === focus ? 'bg-accent/10' : ''}`}>
                      <td className="px-2 py-1 font-semibold">{r.symbol}</td>
                      {METRICS.map((m) => (
                        <td key={m.key} className="num whitespace-nowrap px-2 py-1 text-right">
                          {fmtMetric(r[m.key] as number | null, m.kind)}
                        </td>
                      ))}
                    </tr>
                  ))}
                  {Object.entries(errors).map(([s, e]) => (
                    <tr key={s} className="border-t border-line/50">
                      <td className="px-2 py-1 font-semibold">{s}</td>
                      <td colSpan={METRICS.length} className="px-2 py-1 text-downc">
                        {e}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
