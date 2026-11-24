// 系列の色。固定の順番で割り当てる（暗い背景・色覚の違いで検証済みの順。5 色目以降は凡例・ラベル必須）
export const PALETTE = ['#3b82f6', '#d97706', '#0d9488', '#c026d3', '#d55181', '#0ca30c', '#9085e9', '#e66767'];
export const NEG = '#d97706';
export const INK = '#e6ebf5';
export const MUTE = '#8b97ae';
export const GRID = 'rgba(255,255,255,0.08)';
export const SURFACE = '#0b0f17';

export const alpha = (hex: string, a: number) => {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
};

export function fmtNum(v: number | null | undefined, unit = '') {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  const a = Math.abs(v);
  const n = a >= 1000 ? v.toLocaleString('en-US', { maximumFractionDigits: 0 }) : a >= 100 ? v.toFixed(1) : v.toFixed(2);
  return unit && !unit.startsWith('（') ? `${n}${unit}` : n;
}
