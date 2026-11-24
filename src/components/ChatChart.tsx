import { useRef, useState } from 'react';
import type { ChartSpec } from '../types';

// 系列の色（固定の順番で割り当てる。暗い背景・色覚の違いで検証済み）
const COLORS = ['#3b82f6', '#d97706', '#0d9488', '#c026d3'];
const NEG = '#d97706';

const fmt = (v: number | null, unit: string) => {
  if (v === null || !Number.isFinite(v)) return '—';
  const a = Math.abs(v);
  const n = a >= 1000 ? v.toLocaleString('en-US', { maximumFractionDigits: 0 }) : a >= 100 ? v.toFixed(1) : v.toFixed(2);
  return unit.startsWith('（') ? n : `${n}${unit}`;
};

function Legend({ spec }: { spec: ChartSpec }) {
  if (spec.series.length < 2) return null;
  return (
    <div className="mb-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-mute">
      {spec.series.map((s, i) => (
        <span key={s.name} className="flex items-center gap-1">
          <i className="inline-block h-2 w-2 rounded-sm" style={{ background: COLORS[i] }} />
          {s.name}
        </span>
      ))}
    </div>
  );
}

/** 棒グラフ（横向き）。系列が複数なら項目ごとに並べる */
function Bars({ spec }: { spec: ChartSpec }) {
  const [hover, setHover] = useState<string | null>(null);
  const all = spec.series.flatMap((s) => s.values).filter((v): v is number => v !== null);
  const lo = Math.min(0, ...all);
  const hi = Math.max(0, ...all);
  const span = hi - lo || 1;
  const pos = (v: number) => ((v - lo) / span) * 100;
  const zero = pos(0);
  return (
    <div className="space-y-1">
      {spec.labels.map((label, li) => (
        <div key={label + li} className="flex items-center gap-2">
          <span className="w-20 shrink-0 truncate text-right text-[11px] text-ink" title={label}>
            {label}
          </span>
          <div className="relative flex-1 space-y-[2px] py-[1px]">
            <div className="absolute bottom-0 top-0 w-px bg-white/20" style={{ left: `${zero}%` }} />
            {spec.series.map((s, si) => {
              const v = s.values[li];
              const key = `${li}-${si}`;
              if (v === null || v === undefined) return <div key={si} className="h-2.5 text-[9px] leading-[10px] text-mute">—</div>;
              const neg = v < 0;
              return (
                <div key={si} className="relative h-2.5" onMouseEnter={() => setHover(key)} onMouseLeave={() => setHover(null)}>
                  <div
                    className="absolute top-0 h-full"
                    title={`${label}${spec.series.length > 1 ? ` · ${s.name}` : ''}: ${fmt(v, spec.unit)}`}
                    style={{
                      left: `${Math.min(pos(v), zero)}%`,
                      width: `max(${Math.abs(pos(v) - zero)}%, 2px)`,
                      background: spec.series.length > 1 ? COLORS[si] : neg ? NEG : COLORS[0],
                      borderRadius: neg ? '4px 0 0 4px' : '0 4px 4px 0',
                      opacity: hover && hover !== key ? 0.6 : 1,
                    }}
                  />
                </div>
              );
            })}
          </div>
          <span className="num w-20 shrink-0 text-[10px] text-mute">
            {spec.series.length === 1 ? fmt(spec.series[0].values[li], spec.unit) : ''}
          </span>
        </div>
      ))}
    </div>
  );
}

/** 折れ線。マウスを乗せると、その点の値をすべての系列について表示 */
function Lines({ spec }: { spec: ChartSpec }) {
  const [hi, setHi] = useState<number | null>(null);
  const ref = useRef<SVGSVGElement>(null);
  const W = 560;
  const H = 180;
  const L = 44;
  const R = 8;
  const T = 8;
  const B = 22;
  const n = spec.labels.length;
  const all = spec.series.flatMap((s) => s.values).filter((v): v is number => v !== null);
  let lo = Math.min(...all);
  let top = Math.max(...all);
  if (lo === top) {
    lo -= 1;
    top += 1;
  }
  const pad = (top - lo) * 0.08;
  lo -= pad;
  top += pad;
  const x = (k: number) => L + (n <= 1 ? 0 : (k / (n - 1)) * (W - L - R));
  const y = (v: number) => T + (1 - (v - lo) / (top - lo)) * (H - T - B);
  const ticks = [lo + pad, (lo + top) / 2, top - pad];
  const xt = n > 1 ? [0, Math.floor((n - 1) / 2), n - 1] : [0];
  return (
    <div className="relative">
      <svg
        ref={ref}
        viewBox={`0 0 ${W} ${H}`}
        className="block w-full"
        role="img"
        aria-label={spec.title}
        onMouseMove={(e) => {
          const r = ref.current!.getBoundingClientRect();
          const px = ((e.clientX - r.left) / r.width) * W;
          setHi(Math.max(0, Math.min(n - 1, Math.round(((px - L) / (W - L - R)) * (n - 1)))));
        }}
        onMouseLeave={() => setHi(null)}
      >
        {ticks.map((t, i) => (
          <g key={i}>
            <line x1={L} x2={W - R} y1={y(t)} y2={y(t)} stroke="rgba(255,255,255,.07)" />
            <text x={L - 4} y={y(t) + 3} textAnchor="end" fontSize="10" fill="#8b97ae">
              {fmt(t, spec.unit.startsWith('（') ? '' : '')}
            </text>
          </g>
        ))}
        {xt.map((k) => (
          <text key={k} x={x(k)} y={H - 6} textAnchor={k === 0 ? 'start' : k === n - 1 ? 'end' : 'middle'} fontSize="10" fill="#8b97ae">
            {spec.labels[k]}
          </text>
        ))}
        {spec.series.map((s, si) => {
          const d = s.values.map((v, k) => (v === null ? '' : `${s.values[k - 1] === null || k === 0 ? 'M' : 'L'}${x(k).toFixed(1)},${y(v).toFixed(1)}`)).join('');
          return <path key={s.name} d={d} fill="none" stroke={COLORS[si]} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />;
        })}
        {hi !== null && <line x1={x(hi)} x2={x(hi)} y1={T} y2={H - B} stroke="rgba(255,255,255,.25)" />}
        {hi !== null &&
          spec.series.map((s, si) =>
            s.values[hi] === null ? null : <circle key={si} cx={x(hi)} cy={y(s.values[hi]!)} r="3.5" fill={COLORS[si]} stroke="#121826" strokeWidth="2" />,
          )}
      </svg>
      {hi !== null && (
        <div className="pointer-events-none absolute right-1 top-1 rounded border border-line bg-bg/95 px-2 py-1 text-[10px]">
          <div className="text-mute">{spec.labels[hi]}</div>
          {spec.series.map((s, si) => (
            <div key={s.name} className="num flex items-center gap-1.5">
              <i className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: COLORS[si] }} />
              <span className="text-mute">{s.name}</span>
              <span className="ml-auto pl-2">{fmt(s.values[hi], spec.unit)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function ChatChart({ spec }: { spec: ChartSpec }) {
  return (
    <figure className="my-2 rounded-lg border border-line bg-bg/60 p-3">
      <figcaption className="mb-1 flex items-baseline justify-between gap-2">
        <span className="text-xs font-semibold text-ink">{spec.title}</span>
        {spec.unit && <span className="text-[10px] text-mute">単位: {spec.unit.replace(/[（）]/g, '')}</span>}
      </figcaption>
      <Legend spec={spec} />
      {spec.kind === 'bar' ? <Bars spec={spec} /> : <Lines spec={spec} />}
      {spec.source && <p className="mt-1.5 text-[10px] text-mute">出典: {spec.source}</p>}
    </figure>
  );
}
