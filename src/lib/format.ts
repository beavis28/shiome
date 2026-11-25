import { getLang } from './i18n';

export const fmtPrice = (v: number | null | undefined) =>
  v === null || v === undefined ? '—' : v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const fmtPct = (v: number | null | undefined, digits = 1) =>
  v === null || v === undefined || !Number.isFinite(v) ? '—' : `${v > 0 ? '+' : ''}${v.toFixed(digits)}%`;

export const fmtBig = (v: number | null | undefined) => {
  if (v === null || v === undefined) return '—';
  if (v >= 1e12) return `${(v / 1e12).toFixed(2)}T`;
  if (v >= 1e9) return `${(v / 1e9).toFixed(1)}B`;
  if (v >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  return v.toLocaleString('en-US');
};

const todayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/** 今日から date (YYYY-MM-DD) までの日数 */
export function daysUntil(date: string | null | undefined): number | null {
  if (!date) return null;
  const a = new Date(todayStr() + 'T00:00:00Z').getTime();
  const b = new Date(date + 'T00:00:00Z').getTime();
  return Math.round((b - a) / 86400_000);
}

const WD = ['日', '月', '火', '水', '木', '金', '土'];
const WD_EN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export function fmtDate(date: string | null | undefined) {
  if (!date) return '—';
  const d = new Date(date + 'T12:00:00Z');
  return getLang() === 'en' ? `${d.getUTCMonth() + 1}/${d.getUTCDate()} ${WD_EN[d.getUTCDay()]}` : `${d.getUTCMonth() + 1}/${d.getUTCDate()}(${WD[d.getUTCDay()]})`;
}

/** 米国東部時間の日時を、閲覧者のローカル時刻（例: "21:30"）に変換 */
export function etToLocal(date: string, timeET: string): { time: string; dayShift: number } {
  const [h, m] = timeET.split(':').map(Number);
  // その日の ET の UTC オフセットを求める（夏時間対応）
  const probe = new Date(`${date}T12:00:00Z`);
  const etHour = Number(
    new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', hour12: false }).format(probe),
  );
  const offset = etHour - 12; // -4 or -5
  const utc = new Date(Date.UTC(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8, 10), h - offset, m));
  const local = new Date(utc);
  const localDate = `${local.getFullYear()}-${String(local.getMonth() + 1).padStart(2, '0')}-${String(local.getDate()).padStart(2, '0')}`;
  return {
    time: `${String(local.getHours()).padStart(2, '0')}:${String(local.getMinutes()).padStart(2, '0')}`,
    dayShift: Math.round((new Date(localDate).getTime() - new Date(date).getTime()) / 86400_000),
  };
}

export const localTzLabel = () => {
  const off = -new Date().getTimezoneOffset() / 60;
  return `UTC${off >= 0 ? '+' : ''}${off}`;
};
