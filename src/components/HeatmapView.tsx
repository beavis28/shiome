import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { api } from '../lib/api';
import { fmtBig, fmtPrice } from '../lib/format';
import { squarify, type Rect } from '../lib/treemap';
import type { HeatItem } from '../types';
import { Card } from './ui';
import { pick, useT } from '../lib/i18n';
import { sectorLabel } from '../lib/names';

// 色は「上昇・下落」の向きだけを表す 2 色＋中央のグレー（暗い背景・色覚の違いで検証済み）
const UP = [13, 148, 136]; // #0d9488
const DOWN = [224, 83, 61]; // #e0533d
const MID = [52, 60, 78]; // 変化なし

type Period = 'change1d' | 'vs50d' | 'change52w';
type JaEn = { ja: string; en: string };
const PERIODS: { key: Period; label: JaEn; range: number; hint: JaEn }[] = [
  { key: 'change1d', label: { ja: '1日', en: '1D' }, range: 3, hint: { ja: '前日終値からの変化率', en: 'Change from previous close' } },
  { key: 'vs50d', label: { ja: '50日線乖離', en: 'vs 50D MA' }, range: 15, hint: { ja: '50 日移動平均からの乖離率', en: 'Distance from the 50-day moving average' } },
  { key: 'change52w', label: { ja: '52週', en: '52W' }, range: 50, hint: { ja: '52 週前からの変化率', en: 'Change over 52 weeks' } },
];

function color(v: number | null, range: number) {
  if (v === null || !Number.isFinite(v)) return 'rgb(40,46,60)';
  const t = Math.min(Math.abs(v) / range, 1);
  const to = v >= 0 ? UP : DOWN;
  const c = MID.map((m, i) => Math.round(m + (to[i] - m) * t));
  return `rgb(${c.join(',')})`;
}

const fmtChg = (v: number | null) => (v === null || !Number.isFinite(v) ? '—' : `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(2)}%`);

interface Props {
  watchlist: string[];
  refreshMs: number;
  onPick: (symbol: string) => void;
}

export function HeatmapView({ watchlist, refreshMs, onPick }: Props) {
  const { t, lang } = useT();
  const [universe, setUniverse] = useState<'major' | 'watchlist'>('major');
  const [period, setPeriod] = useState<Period>('change1d');
  const [items, setItems] = useState<HeatItem[]>([]);
  const [asOf, setAsOf] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [hover, setHover] = useState<{ item: HeatItem; x: number; y: number } | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const p = PERIODS.find((x) => x.key === period)!;
  const wlKey = watchlist.join(',');

  useEffect(() => {
    let alive = true;
    const load = () => {
      if (document.hidden) return;
      setLoading(true);
      api
        .heatmap(universe, universe === 'watchlist' ? wlKey.split(',').filter(Boolean) : [])
        .then((r) => {
          if (!alive) return;
          setItems(r.items);
          setAsOf(r.asOf);
          setError(null);
        })
        .catch((e) => alive && setError(e instanceof Error ? e.message : String(e)))
        .finally(() => alive && setLoading(false));
    };
    load();
    const id = setInterval(load, Math.max(refreshMs, 60_000));
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [universe, wlKey, refreshMs]);

  useLayoutEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // セクター → 銘柄の 2 段のツリーマップ
  const layout = useMemo(() => {
    const groups = new Map<string, HeatItem[]>();
    for (const it of items) groups.set(it.sector, [...(groups.get(it.sector) ?? []), it]);
    const sectors = [...groups.entries()]
      .map(([name, list]) => ({ name, list: list.sort((a, b) => b.marketCap - a.marketCap), cap: list.reduce((a, b) => a + b.marketCap, 0) }))
      .sort((a, b) => b.cap - a.cap);
    const outer = squarify(
      sectors.map((s) => s.cap),
      { x: 0, y: 0, w: size.w, h: size.h },
    );
    return sectors.map((s, i) => {
      const r = outer[i];
      const head = r.h > 40 && r.w > 60 ? 15 : 0;
      const inner = squarify(
        s.list.map((x) => x.marketCap),
        { x: r.x + 1, y: r.y + head + 1, w: r.w - 2, h: r.h - head - 2 },
      );
      // 時価総額で重み付けした、セクター全体の変化率
      const wsum = s.list.reduce((a, b) => a + (b[period] !== null ? b.marketCap : 0), 0);
      const avg = wsum ? s.list.reduce((a, b) => a + (b[period] ?? 0) * b.marketCap, 0) / wsum : null;
      return { ...s, rect: r, head, tiles: s.list.map((it, k) => ({ it, r: inner[k] })), avg };
    });
  }, [items, size, period]);

  const sectorSummary = useMemo(() => [...layout].sort((a, b) => (b.avg ?? -999) - (a.avg ?? -999)), [layout]);

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <Card className="flex flex-wrap items-center gap-x-4 gap-y-1.5 px-3 py-2">
        <span className="flex items-center gap-1">
          <span className="text-[10px] text-mute">{t('対象', 'Universe')}</span>
          {(
            [
              ['major', t('主要米国株（約120銘柄）', 'Major US stocks (~120)')],
              ['watchlist', t('ウォッチリスト', 'Watchlist')],
            ] as const
          ).map(([k, label]) => (
            <button
              key={k}
              aria-pressed={universe === k}
              onClick={() => setUniverse(k)}
              className={`rounded-full border px-2 py-0.5 text-[11px] ${universe === k ? 'border-accent bg-accent/15 text-accent' : 'border-line text-mute hover:text-ink'}`}
            >
              {label}
            </button>
          ))}
        </span>
        <span className="flex items-center gap-1">
          <span className="text-[10px] text-mute">{t('期間', 'Period')}</span>
          {PERIODS.map((x) => (
            <button
              key={x.key}
              title={pick(x.hint, lang)}
              aria-pressed={period === x.key}
              onClick={() => setPeriod(x.key)}
              className={`rounded-full border px-2 py-0.5 text-[11px] ${period === x.key ? 'border-accent bg-accent/15 text-accent' : 'border-line text-mute hover:text-ink'}`}
            >
              {pick(x.label, lang)}
            </button>
          ))}
        </span>
        {/* 凡例 */}
        <span className="flex items-center gap-1.5 text-[10px] text-mute">
          <span className="num">−{p.range}%</span>
          <span
            className="h-2 w-28 rounded-sm"
            style={{ background: `linear-gradient(90deg, rgb(${DOWN}), rgb(${MID}), rgb(${UP}))` }}
          />
          <span className="num">+{p.range}%</span>
          <span>{t('· 面積 = 時価総額', '· Area = market cap')}</span>
        </span>
        <span className="num ml-auto text-[10px] text-mute">
          {loading ? t('更新中…', 'Updating…') : asOf ? t(`${new Date(asOf).toLocaleTimeString('ja-JP')} 時点 · Yahoo Finance`, `As of ${new Date(asOf).toLocaleTimeString('en-US')} · Yahoo Finance`) : ''}
        </span>
      </Card>

      {/* セクター別の平均（時価総額加重） */}
      <Card className="flex flex-wrap gap-1 px-2 py-1.5">
        {sectorSummary.map((s) => (
          <span key={s.name} className="flex items-center gap-1.5 rounded px-1.5 py-0.5 text-[11px]" style={{ background: color(s.avg, p.range) }}>
            <span className="text-white/90">{sectorLabel(s.name, lang)}</span>
            <span className="num font-semibold text-white">{fmtChg(s.avg)}</span>
          </span>
        ))}
        {!sectorSummary.length && <span className="px-1 text-[11px] text-mute">{error ?? t('読み込み中…', 'Loading…')}</span>}
      </Card>

      <Card className="relative min-h-0 flex-1 overflow-hidden p-1">
        <div ref={boxRef} className="relative h-full w-full" onMouseLeave={() => setHover(null)}>
          {layout.map((s) => (
            <div key={s.name}>
              {s.head > 0 && (
                <div
                  className="absolute truncate px-1 text-[10px] font-semibold leading-[15px] text-mute"
                  style={{ left: s.rect.x, top: s.rect.y, width: s.rect.w }}
                >
                  {sectorLabel(s.name, lang)} <span className="num font-normal">{fmtChg(s.avg)}</span>
                </div>
              )}
              {s.tiles.map(({ it, r }) => (
                <Tile key={it.symbol} it={it} r={r} v={it[period]} range={p.range} inWatchlist={watchlist.includes(it.symbol)} onPick={onPick} onHover={setHover} />
              ))}
            </div>
          ))}
          {hover && (
            <div
              className="pointer-events-none absolute z-20 w-52 rounded-md border border-line bg-bg/95 px-2.5 py-1.5 text-[11px] shadow-lg"
              style={{ left: Math.min(hover.x + 12, size.w - 215), top: Math.min(hover.y + 12, size.h - 110) }}
            >
              <div className="font-semibold">
                {hover.item.symbol} <span className="font-normal text-mute">{hover.item.name}</span>
              </div>
              <div className="text-mute">{sectorLabel(hover.item.sector, lang)}</div>
              <div className="num mt-1 grid grid-cols-2 gap-x-2">
                <span className="text-mute">{t('株価', 'Price')}</span>
                <span className="text-right">${fmtPrice(hover.item.price)}</span>
                <span className="text-mute">{t('時価総額', 'Market cap')}</span>
                <span className="text-right">${fmtBig(hover.item.marketCap)}</span>
                <span className="text-mute">{t('1日', '1D')}</span>
                <span className="text-right">{fmtChg(hover.item.change1d)}</span>
                <span className="text-mute">{t('50日線乖離', 'vs 50D MA')}</span>
                <span className="text-right">{fmtChg(hover.item.vs50d)}</span>
                <span className="text-mute">{t('52週', '52W')}</span>
                <span className="text-right">{fmtChg(hover.item.change52w)}</span>
              </div>
              <div className="mt-1 text-[10px] text-accent">
                {watchlist.includes(hover.item.symbol) ? t('クリックで詳細を表示', 'Click for details') : t('クリックでウォッチリストに追加して詳細を表示', 'Click to add to watchlist and view details')}
              </div>
            </div>
          )}
        </div>
      </Card>
      <p className="px-1 text-[10px] text-mute">
        {t(
          '主要米国株は時価総額の大きい約 120 銘柄の手動リストです。業界は Yahoo Finance の分類にもとづきます。',
          'Major US stocks is a hand-picked list of ~120 of the largest companies by market cap. Sectors follow Yahoo Finance classification.',
        )}
      </p>
    </div>
  );
}

function Tile({
  it,
  r,
  v,
  range,
  inWatchlist,
  onPick,
  onHover,
}: {
  it: HeatItem;
  r: Rect;
  v: number | null;
  range: number;
  inWatchlist: boolean;
  onPick: (s: string) => void;
  onHover: (h: { item: HeatItem; x: number; y: number } | null) => void;
}) {
  if (r.w < 1 || r.h < 1) return null;
  const fs = Math.max(9, Math.min(20, r.w / 4.2, r.h / 2.6));
  const showSym = r.w > 26 && r.h > 16;
  const showChg = r.w > 40 && r.h > 30;
  return (
    <button
      type="button"
      onClick={() => onPick(it.symbol)}
      onMouseMove={(e) => {
        const box = (e.currentTarget.parentElement?.parentElement as HTMLElement).getBoundingClientRect();
        onHover({ item: it, x: e.clientX - box.left, y: e.clientY - box.top });
      }}
      className="absolute flex flex-col items-center justify-center overflow-hidden rounded-[3px] text-white outline-none transition-[filter] hover:brightness-125 focus-visible:ring-2 focus-visible:ring-accent"
      style={{ left: r.x + 1, top: r.y + 1, width: r.w - 2, height: r.h - 2, background: color(v, range), boxShadow: inWatchlist ? 'inset 0 0 0 1.5px rgba(255,255,255,.55)' : undefined }}
      aria-label={`${it.symbol} ${fmtChg(v)}`}
    >
      {showSym && (
        <span className="font-semibold leading-none" style={{ fontSize: fs }}>
          {it.symbol}
        </span>
      )}
      {showChg && (
        <span className="num mt-0.5 leading-none text-white/85" style={{ fontSize: Math.max(9, fs * 0.62) }}>
          {fmtChg(v)}
        </span>
      )}
    </button>
  );
}
