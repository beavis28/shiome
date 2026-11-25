// テクニカル指標の計算（日足終値ベース）
import type { Bar } from '../types';
import { tr } from './i18n';

export type Series = (number | null)[];

export function sma(values: number[], n: number): Series {
  const out: Series = [];
  let sum = 0;
  values.forEach((v, i) => {
    sum += v;
    if (i >= n) sum -= values[i - n];
    out.push(i >= n - 1 ? sum / n : null);
  });
  return out;
}

export function ema(values: number[], n: number): Series {
  const k = 2 / (n + 1);
  const out: Series = [];
  let prev: number | null = null;
  values.forEach((v, i) => {
    if (i < n - 1) return out.push(null);
    if (prev === null) {
      prev = values.slice(0, n).reduce((a, b) => a + b, 0) / n;
    } else {
      prev = v * k + prev * (1 - k);
    }
    out.push(prev);
  });
  return out;
}

/** Wilder 方式の RSI */
export function rsi(values: number[], n = 14): Series {
  const out: Series = [null];
  let gain = 0;
  let loss = 0;
  for (let i = 1; i < values.length; i++) {
    const d = values[i] - values[i - 1];
    const g = Math.max(d, 0);
    const l = Math.max(-d, 0);
    if (i <= n) {
      gain += g / n;
      loss += l / n;
      out.push(i === n ? (loss === 0 ? 100 : 100 - 100 / (1 + gain / loss)) : null);
    } else {
      gain = (gain * (n - 1) + g) / n;
      loss = (loss * (n - 1) + l) / n;
      out.push(loss === 0 ? 100 : 100 - 100 / (1 + gain / loss));
    }
  }
  return out;
}

export function macd(values: number[], fast = 12, slow = 26, signal = 9) {
  const f = ema(values, fast);
  const s = ema(values, slow);
  const line: Series = values.map((_, i) => (f[i] !== null && s[i] !== null ? f[i]! - s[i]! : null));
  const start = line.findIndex((v) => v !== null);
  const sig: Series = values.map(() => null);
  if (start >= 0) {
    const e = ema(line.slice(start) as number[], signal);
    e.forEach((v, i) => (sig[start + i] = v));
  }
  const hist: Series = line.map((v, i) => (v !== null && sig[i] !== null ? v - sig[i]! : null));
  return { line, signal: sig, hist };
}

export function bollinger(values: number[], n = 20, k = 2) {
  const mid = sma(values, n);
  const upper: Series = [];
  const lower: Series = [];
  values.forEach((_, i) => {
    const m = mid[i];
    if (m === null) {
      upper.push(null);
      lower.push(null);
      return;
    }
    const w = values.slice(i - n + 1, i + 1);
    const sd = Math.sqrt(w.reduce((a, v) => a + (v - m) ** 2, 0) / n);
    upper.push(m + k * sd);
    lower.push(m - k * sd);
  });
  return { mid, upper, lower };
}

export type Tone = 'up' | 'down' | 'warn' | 'neutral';
export interface Signal {
  key: string;
  label: string; // 指標名
  value: string; // 状態
  tone: Tone;
  hint: string; // ツールチップ用の説明
}

export interface Technicals {
  closes: number[];
  sma20: Series;
  sma50: Series;
  sma200: Series;
  rsi: Series;
  macd: ReturnType<typeof macd>;
  bb: ReturnType<typeof bollinger>;
  last: {
    rsi: number | null;
    macd: number | null;
    macdSignal: number | null;
    percentB: number | null;
    sma50: number | null;
    sma200: number | null;
  };
  signals: Signal[];
}

const lastOf = (s: Series) => s[s.length - 1] ?? null;

export function computeTechnicals(bars: Bar[]): Technicals {
  const closes = bars.map((b) => b.close);
  const t = {
    closes,
    sma20: sma(closes, 20),
    sma50: sma(closes, 50),
    sma200: sma(closes, 200),
    rsi: rsi(closes, 14),
    macd: macd(closes),
    bb: bollinger(closes),
  };
  const price = closes[closes.length - 1];
  const r = lastOf(t.rsi);
  const m = lastOf(t.macd.line);
  const ms = lastOf(t.macd.signal);
  const up = lastOf(t.bb.upper);
  const lo = lastOf(t.bb.lower);
  const pB = up !== null && lo !== null && up !== lo ? (price - lo) / (up - lo) : null;
  const s50 = lastOf(t.sma50);
  const s200 = lastOf(t.sma200);

  const signals: Signal[] = [];

  if (r !== null) {
    signals.push({
      key: 'rsi',
      label: 'RSI(14)',
      value: `${r >= 70 ? tr('買われすぎ', 'Overbought') : r <= 30 ? tr('売られすぎ', 'Oversold') : tr('中立', 'Neutral')} ${r.toFixed(0)}`,
      tone: r >= 70 ? 'down' : r <= 30 ? 'up' : 'neutral',
      hint: tr('70以上=買われすぎ、30以下=売られすぎの目安', '70+ = overbought, 30 or below = oversold (rule of thumb)'),
    });
  }

  if (m !== null && ms !== null) {
    // 直近5日以内のクロスを検出
    let cross: 'golden' | 'dead' | null = null;
    for (let i = closes.length - 1; i >= Math.max(1, closes.length - 5); i--) {
      const a = t.macd.hist[i - 1];
      const b = t.macd.hist[i];
      if (a === null || b === null) continue;
      if (a <= 0 && b > 0) cross = 'golden';
      if (a >= 0 && b < 0) cross = 'dead';
      if (cross) break;
    }
    signals.push({
      key: 'macd',
      label: 'MACD',
      value:
        cross === 'golden'
          ? tr('GC（直近）', 'Bull cross')
          : cross === 'dead'
            ? tr('DC（直近）', 'Bear cross')
            : m > ms
              ? tr('シグナル上', 'Above signal')
              : tr('シグナル下', 'Below signal'),
      tone: cross === 'golden' || (!cross && m > ms) ? 'up' : 'down',
      hint: tr('MACD(12,26,9)。GC=MACDがシグナルを上抜け、DC=下抜け（5営業日以内）', 'MACD(12,26,9). Bull cross = MACD crossed above signal, bear cross = below (within 5 trading days)'),
    });
  }

  if (pB !== null) {
    signals.push({
      key: 'bb',
      label: tr('ボリンジャー', 'Bollinger'),
      value:
        pB > 1
          ? tr('+2σ 超え', 'Above +2σ')
          : pB < 0
            ? tr('−2σ 割れ', 'Below −2σ')
            : pB > 0.8
              ? tr('上限付近', 'Near upper')
              : pB < 0.2
                ? tr('下限付近', 'Near lower')
                : `%B ${(pB * 100).toFixed(0)}`,
      tone: pB > 1 ? 'warn' : pB < 0 ? 'warn' : 'neutral',
      hint: tr('BB(20, 2σ)。%B=バンド内の位置（0=下限、100=上限）', 'BB(20, 2σ). %B = position within the band (0 = lower, 100 = upper)'),
    });
  }

  if (s50 !== null && s200 !== null) {
    signals.push({
      key: 'trend',
      label: 'SMA50/200',
      value:
        s50 > s200
          ? price > s50
            ? tr('上昇トレンド', 'Uptrend')
            : tr('50日線割れ', 'Below 50D')
          : price < s50
            ? tr('下降トレンド', 'Downtrend')
            : tr('50日線上', 'Above 50D'),
      tone: s50 > s200 ? (price > s50 ? 'up' : 'warn') : price < s50 ? 'down' : 'warn',
      hint: tr('50日線と200日線の位置関係、および株価と50日線の位置', '50-day vs 200-day MA, and price vs the 50-day MA'),
    });
  }

  return {
    ...t,
    last: { rsi: r, macd: m, macdSignal: ms, percentB: pB, sma50: s50, sma200: s200 },
    signals,
  };
}
