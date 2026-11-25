// 米国の重要経済指標カレンダー
//  - CPI・雇用統計・PCE・GDP など: FRED API の release/dates（予定日を含む）から取得
//  - FOMC: FRB 公表の日程（下の FOMC_MEETINGS）。FRB が日程を変更したらここを更新する。
//    出典: https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm
//    2027 年分は 2026-11-12 改定版（10月会合は戦略討議のみで政策決定なし、最終会合は 11/16-17）。
import { tx } from './lang.ts';
import type { EconEvent, EconPayload } from '../src/types.ts';
import { cached, HOUR } from './cache.ts';

const FOMC_MEETINGS: { start: string; end: string; note?: string }[] = [
  { start: '2026-01-27', end: '2026-01-28' },
  { start: '2026-03-17', end: '2026-03-18' },
  { start: '2026-04-28', end: '2026-04-29' },
  { start: '2026-06-16', end: '2026-06-17' },
  { start: '2026-07-28', end: '2026-07-29' },
  { start: '2026-09-15', end: '2026-09-16' },
  { start: '2026-10-27', end: '2026-10-28' },
  { start: '2026-12-08', end: '2026-12-09' },
  { start: '2027-01-26', end: '2027-01-27' },
  { start: '2027-03-16', end: '2027-03-17' },
  { start: '2027-04-27', end: '2027-04-28' },
  { start: '2027-06-08', end: '2027-06-09' },
  { start: '2027-07-27', end: '2027-07-28' },
  { start: '2027-09-14', end: '2027-09-15' },
  { start: '2027-10-26', end: '2027-10-27', note: '戦略討議のみ（政策決定なし）' },
  { start: '2027-11-16', end: '2027-11-17' },
  { start: '2028-01-25', end: '2028-01-26' },
];

// FRED のリリース ID（https://fred.stlouisfed.org/releases）
const FRED_RELEASES: { id: number; key: string; label: string; timeET: string; importance: 'high' | 'medium' }[] = [
  { id: 10, key: 'CPI', label: 'CPI（消費者物価指数）', timeET: '08:30', importance: 'high' },
  { id: 50, key: 'NFP', label: '雇用統計', timeET: '08:30', importance: 'high' },
  { id: 54, key: 'PCE', label: 'PCE（個人所得・支出）', timeET: '08:30', importance: 'high' },
  { id: 53, key: 'GDP', label: 'GDP', timeET: '08:30', importance: 'high' },
  { id: 46, key: 'PPI', label: 'PPI（生産者物価指数）', timeET: '08:30', importance: 'medium' },
  { id: 9, key: 'RETAIL', label: '小売売上高', timeET: '08:30', importance: 'medium' },
];

const today = () => new Date().toISOString().slice(0, 10);

function fomcEvents(): EconEvent[] {
  return FOMC_MEETINGS.map((m) => ({
    date: m.end,
    timeET: '14:00',
    key: 'FOMC',
    label: 'FOMC 政策金利発表',
    detail: m.note ?? `会合 ${m.start.slice(5)}〜${m.end.slice(5)}`,
    importance: m.note ? ('medium' as const) : ('high' as const),
    source: 'FOMC' as const,
  }));
}

async function fredRelease(rel: (typeof FRED_RELEASES)[number], apiKey: string): Promise<EconEvent[]> {
  return cached(`fred:${rel.id}:${today()}`, 12 * HOUR, async () => {
    const start = new Date(Date.now() - 7 * 86400_000).toISOString().slice(0, 10);
    const qs = new URLSearchParams({
      release_id: String(rel.id),
      api_key: apiKey,
      file_type: 'json',
      include_release_dates_with_no_data: 'true',
      realtime_start: start,
      realtime_end: '9999-12-31',
      sort_order: 'asc',
      limit: '60',
    });
    const res = await fetch(`https://api.stlouisfed.org/fred/release/dates?${qs}`);
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error_message?: string };
      if (/api_key/i.test(body.error_message ?? '')) {
        throw new Error(tx('FRED_API_KEY が正しくありません（FRED のキーは英小文字と数字の 32 文字です）', 'FRED_API_KEY is invalid (FRED keys are 32 lowercase letters and digits)'));
      }
      throw new Error(tx(`FRED エラー (${res.status})`, `FRED error (${res.status})`));
    }
    const json = (await res.json()) as { release_dates?: { date: string }[] };
    const dates = [...new Set((json.release_dates ?? []).map((d) => d.date))];
    return dates.map((date) => ({
      date,
      timeET: rel.timeET,
      key: rel.key,
      label: rel.label,
      importance: rel.importance,
      source: 'FRED' as const,
    }));
  });
}

export async function fetchEcon(): Promise<EconPayload> {
  const warnings: string[] = [];
  const events: EconEvent[] = [...fomcEvents()];
  const key = process.env.FRED_API_KEY;
  if (!key) {
    warnings.push(tx('FRED_API_KEY が未設定のため、FOMC 以外の指標は表示されません', 'FRED_API_KEY is not set, so only FOMC dates are shown'));
  } else {
    const results = await Promise.allSettled(FRED_RELEASES.map((r) => fredRelease(r, key)));
    const failed = new Map<string, string[]>();
    results.forEach((r, i) => {
      if (r.status === 'fulfilled') events.push(...r.value);
      else {
        const m = r.reason instanceof Error ? r.reason.message : String(r.reason);
        failed.set(m, [...(failed.get(m) ?? []), tx(FRED_RELEASES[i].label.replace(/（.*）/, ''), FRED_RELEASES[i].key)]);
      }
    });
    for (const [m, labels] of failed) warnings.push(labels.length === FRED_RELEASES.length ? m : `${labels.join(tx('・', ', '))}: ${m}`);
  }
  const from = new Date(Date.now() - 2 * 86400_000).toISOString().slice(0, 10);
  const to = new Date(Date.now() + 120 * 86400_000).toISOString().slice(0, 10);
  return {
    events: events.filter((e) => e.date >= from && e.date <= to).sort((a, b) => (a.date + a.timeET).localeCompare(b.date + b.timeET)),
    warnings,
  };
}
