import { useEffect, useRef, useState } from 'react';
import {
  CandlestickSeries,
  ColorType,
  createChart,
  CrosshairMode,
  HistogramSeries,
  LineSeries,
  LineStyle,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  type Time,
} from 'lightweight-charts';
import type { Bar } from '../types';
import type { Series, Technicals } from '../lib/indicators';

const RANGES = { '3M': 63, '6M': 126, '1Y': 252 } as const;
type Range = keyof typeof RANGES;

const toLine = (bars: Bar[], s: Series) =>
  bars.flatMap((b, i) => (s[i] === null || s[i] === undefined ? [] : [{ time: b.time as Time, value: s[i] as number }]));

interface SeriesSet {
  candle: ISeriesApi<'Candlestick'>;
  bbU: ISeriesApi<'Line'>;
  bbL: ISeriesApi<'Line'>;
  s20: ISeriesApi<'Line'>;
  s50: ISeriesApi<'Line'>;
  s200: ISeriesApi<'Line'>;
  rsi: ISeriesApi<'Line'>;
  hist: ISeriesApi<'Histogram'>;
  macd: ISeriesApi<'Line'>;
  sig: ISeriesApi<'Line'>;
}

function applyRange(chart: IChartApi | null, bars: Bar[], range: Range) {
  const from = bars[Math.max(0, bars.length - RANGES[range])]?.time;
  const to = bars[bars.length - 1]?.time;
  if (chart && from && to) chart.timeScale().setVisibleRange({ from: from as Time, to: to as Time });
}

export function PriceChart({ bars, tech, target }: { bars: Bar[]; tech: Technicals; target?: number | null }) {
  const el = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<SeriesSet | null>(null);
  const targetLine = useRef<IPriceLine | null>(null);
  const fitted = useRef(false);
  const [range, setRange] = useState<Range>('6M');

  // チャートは 1 回だけ作り、データ更新時は setData だけ行う（自動更新でズームが戻らないように）
  useEffect(() => {
    if (!el.current) return;
    const chart = createChart(el.current, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor: '#8b97ae',
        fontSize: 11,
        panes: { separatorColor: '#243049', enableResize: false },
      },
      grid: { vertLines: { color: '#1a2236' }, horzLines: { color: '#1a2236' } },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: { borderColor: '#243049' },
      timeScale: { borderColor: '#243049' },
    });
    chartRef.current = chart;
    const line = (color: string, style: LineStyle = LineStyle.Solid, pane = 0) =>
      chart.addSeries(LineSeries, { color, lineWidth: 1, lineStyle: style, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false }, pane);

    // ペイン0: ローソク足 + 移動平均 + ボリンジャーバンド
    const candle = chart.addSeries(CandlestickSeries, {
      upColor: '#22c55e',
      downColor: '#ef4444',
      borderVisible: false,
      wickUpColor: '#22c55e',
      wickDownColor: '#ef4444',
    });
    const set: SeriesSet = {
      candle,
      bbU: line('rgba(148,163,184,0.55)', LineStyle.Dashed),
      bbL: line('rgba(148,163,184,0.55)', LineStyle.Dashed),
      s20: line('#facc15'),
      s50: line('#60a5fa'),
      s200: line('#c084fc'),
      // ペイン1: RSI
      rsi: chart.addSeries(LineSeries, { color: '#f472b6', lineWidth: 1, priceLineVisible: false }, 1),
      // ペイン2: MACD
      hist: chart.addSeries(HistogramSeries, { priceLineVisible: false, lastValueVisible: false }, 2),
      macd: line('#60a5fa', LineStyle.Solid, 2),
      sig: line('#f59e0b', LineStyle.Solid, 2),
    };
    set.rsi.createPriceLine({ price: 70, color: 'rgba(239,68,68,0.6)', lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: false, title: '70' });
    set.rsi.createPriceLine({ price: 30, color: 'rgba(34,197,94,0.6)', lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: false, title: '30' });
    seriesRef.current = set;

    const panes = chart.panes();
    panes[0]?.setStretchFactor(3.2);
    panes[1]?.setStretchFactor(0.9);
    panes[2]?.setStretchFactor(0.9);

    return () => {
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
      targetLine.current = null;
      fitted.current = false;
    };
  }, []);

  useEffect(() => {
    const s = seriesRef.current;
    if (!s) return;
    s.candle.setData(bars.map((b) => ({ time: b.time as Time, open: b.open, high: b.high, low: b.low, close: b.close })));
    s.bbU.setData(toLine(bars, tech.bb.upper));
    s.bbL.setData(toLine(bars, tech.bb.lower));
    s.s20.setData(toLine(bars, tech.sma20));
    s.s50.setData(toLine(bars, tech.sma50));
    s.s200.setData(toLine(bars, tech.sma200));
    s.rsi.setData(toLine(bars, tech.rsi));
    s.hist.setData(
      bars.flatMap((b, i) => {
        const v = tech.macd.hist[i];
        return v === null ? [] : [{ time: b.time as Time, value: v, color: v >= 0 ? 'rgba(34,197,94,0.6)' : 'rgba(239,68,68,0.6)' }];
      }),
    );
    s.macd.setData(toLine(bars, tech.macd.line));
    s.sig.setData(toLine(bars, tech.macd.signal));
    if (targetLine.current) s.candle.removePriceLine(targetLine.current);
    targetLine.current = target
      ? s.candle.createPriceLine({ price: target, color: '#38bdf8', lineWidth: 1, lineStyle: LineStyle.Dotted, axisLabelVisible: true, title: '目標平均' })
      : null;
    if (!fitted.current && bars.length) {
      fitted.current = true;
      applyRange(chartRef.current, bars, range);
    }
  }, [bars, tech, target, range]);

  useEffect(() => {
    applyRange(chartRef.current, bars, range);
    // bars の更新では表示範囲を変えない
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range]);

  return (
    <div className="relative flex h-full min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-1.5 text-[11px] text-mute">
        <span className="flex items-center gap-1"><i className="inline-block h-0.5 w-3 bg-[#facc15]" />SMA20</span>
        <span className="flex items-center gap-1"><i className="inline-block h-0.5 w-3 bg-[#60a5fa]" />SMA50</span>
        <span className="flex items-center gap-1"><i className="inline-block h-0.5 w-3 bg-[#c084fc]" />SMA200</span>
        <span className="flex items-center gap-1"><i className="inline-block h-0.5 w-3 border-t border-dashed border-slate-400" />BB(20,2σ)</span>
        <span className="flex items-center gap-1"><i className="inline-block h-0.5 w-3 border-t border-dotted border-sky-400" />目標平均</span>
        <span className="ml-auto flex gap-1">
          {(Object.keys(RANGES) as Range[]).map((r) => (
            <button
              key={r}
              onClick={() => setRange(r)}
              className={`rounded px-2 py-0.5 ${r === range ? 'bg-accent/20 text-accent' : 'hover:bg-white/5'}`}
            >
              {r}
            </button>
          ))}
        </span>
      </div>
      <div className="relative min-h-0 flex-1">
        <div ref={el} className="absolute inset-0" />
        <span className="pointer-events-none absolute left-2 top-[65%] text-[10px] text-mute">RSI(14)</span>
        <span className="pointer-events-none absolute left-2 top-[83%] text-[10px] text-mute">MACD(12,26,9)</span>
      </div>
    </div>
  );
}
