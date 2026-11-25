import { useMemo, useState } from 'react';
import { daysUntil, etToLocal, fmtDate, localTzLabel } from '../lib/format';
import { useT } from '../lib/i18n';
import { econDetail, econLabel } from '../lib/names';
import type { EconPayload, FedMeeting } from '../types';
import { Card } from './ui';

interface Item {
  date: string;
  timeET: string | null;
  key: string;
  label: string;
  detail?: string;
  importance: 'high' | 'medium' | 'earnings';
  click?: string; // 押したときに開く銘柄
}

// 米国市場の休場日の日本語名
const HOLIDAY_JA: Record<string, string> = {
  "New Year's Day": '元日',
  'Martin Luther King Jr. Day': 'キング牧師記念日',
  "Washington's Birthday": '大統領の日',
  "Presidents' Day": '大統領の日',
  'Good Friday': '聖金曜日',
  'Memorial Day': '戦没者追悼記念日',
  'Juneteenth': 'ジューンティーンス',
  'Juneteenth National Independence Day': 'ジューンティーンス',
  'Independence Day': '独立記念日',
  'Labor Day': 'レイバーデー',
  'Thanksgiving Day': '感謝祭',
  'Christmas': 'クリスマス',
};


const KEY_COLOR: Record<string, string> = {
  FOMC: 'bg-fuchsia-500/20 text-fuchsia-300',
  CPI: 'bg-orange-500/20 text-orange-300',
  NFP: 'bg-sky-500/20 text-sky-300',
  PCE: 'bg-amber-500/20 text-amber-300',
  GDP: 'bg-emerald-500/20 text-emerald-300',
  PPI: 'bg-slate-500/25 text-slate-300',
  RETAIL: 'bg-slate-500/25 text-slate-300',
  EARN: 'bg-indigo-500/25 text-indigo-300',
  MEARN: 'bg-indigo-500/10 text-indigo-300/80 ring-1 ring-inset ring-indigo-400/30',
  IPO: 'bg-teal-500/20 text-teal-300',
  HOL: 'bg-rose-500/20 text-rose-300',
};


// 予測市場（Kalshi）の FOMC の結果の確率。利下げは青緑、据え置きは灰色、利上げは赤橙（色覚の違いでも見分けやすい組み合わせ）
const OUTCOME: Record<string, { ja: string; en: string; color: string }> = {
  C26: { ja: '0.5%以上の利下げ', en: 'Cut >25bp', color: '#0f766e' },
  C25: { ja: '0.25%利下げ', en: 'Cut 25bp', color: '#2dd4bf' },
  H0: { ja: '据え置き', en: 'Hold', color: '#64748b' },
  H25: { ja: '0.25%利上げ', en: 'Hike 25bp', color: '#f08a5d' },
  H26: { ja: '0.5%以上の利上げ', en: 'Hike >25bp', color: '#c2410c' },
};
const ORDER = ['C26', 'C25', 'H0', 'H25', 'H26'];

function FedBar({ m }: { m: FedMeeting }) {
  const { t, lang } = useT();
  const name = (k: string, fallback: string) => (OUTCOME[k] ? OUTCOME[k][lang] : fallback);
  const list = [...m.outcomes].sort((a, b) => ORDER.indexOf(a.key) - ORDER.indexOf(b.key));
  const top = [...m.outcomes].sort((a, b) => b.prob - a.prob).slice(0, 2);
  const all = list.map((o) => `${name(o.key, o.label)} ${(o.prob * 100).toFixed(0)}%`).join(' / ');
  return (
    <a
      href={m.url}
      target="_blank"
      rel="noreferrer noopener"
      title={`${t('予測市場 Kalshi の価格から計算した確率', 'Odds implied by Kalshi prediction-market prices')}: ${all}`}
      className="ml-[3.4rem] mr-1 mt-0.5 block rounded px-1 py-0.5 hover:bg-white/5"
    >
      <div className="flex h-1.5 overflow-hidden rounded-full bg-white/5">
        {list.map((o) => (
          <i key={o.key} style={{ width: `${o.prob * 100}%`, background: OUTCOME[o.key]?.color ?? '#64748b' }} />
        ))}
      </div>
      <div className="mt-0.5 flex flex-wrap gap-x-2 text-[10px] text-mute">
        {top.map((o) => (
          <span key={o.key} className="flex items-center gap-1">
            <i className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: OUTCOME[o.key]?.color ?? '#64748b' }} />
            <span className="text-ink">{name(o.key, o.label)}</span>
            <span className="num">{(o.prob * 100).toFixed(0)}%</span>
          </span>
        ))}
        <span className="ml-auto">{t('予測市場', 'Prediction mkt')}</span>
      </div>
    </a>
  );
}

interface Props {
  econ: EconPayload | null;
  econError: string | null;
  earnings: { symbol: string; date: string }[];
  onSelect: (s: string) => void;
}

export function EconCalendar({ econ, econError, earnings, onSelect }: Props) {
  const [showEarnings, setShowEarnings] = useState(true);
  const [showMajor, setShowMajor] = useState(true);
  const { t, lang } = useT();
  const groups = useMemo(() => {
    const items: Item[] = (econ?.events ?? []).map((e) => ({ ...e, label: econLabel(e, lang), detail: econDetail(e, lang) }));
    if (showEarnings) {
      for (const e of earnings) items.push({ date: e.date, timeET: null, key: 'EARN', label: e.symbol, detail: t('決算発表', 'Earnings report'), importance: 'earnings', click: e.symbol });
    }
    const mine = new Set(earnings.map((e) => e.symbol));
    const m = econ?.market;
    if (m && showMajor) {
      // 主要企業の決算（ウォッチリストにある銘柄は上で出しているので除く）
      for (const e of m.earnings) {
        if (mine.has(e.symbol)) continue;
        const when = e.hour === 'bmo' ? t('寄り前', 'pre-mkt') : e.hour === 'amc' ? t('引け後', 'after close') : '';
        items.push({
          date: e.date,
          timeET: null,
          key: 'MEARN',
          label: `${e.symbol}${when ? ` · ${when}` : ''}`,
          detail: t(`主要企業の決算。予想 EPS ${e.epsEstimate?.toFixed(2) ?? '—'}`, `Major company earnings. EPS est. ${e.epsEstimate?.toFixed(2) ?? '—'}`),
          importance: 'earnings',
          click: e.symbol,
        });
      }
      for (const i of m.ipos) {
        items.push({
          date: i.date,
          timeET: null,
          key: 'IPO',
          label: `${i.name}${i.symbol ? ` (${i.symbol})` : ''}`,
          detail: t(`新規上場 ${i.exchange} · 価格 ${i.price || '未定'}`, `IPO on ${i.exchange} · price ${i.price || 'TBD'}`),
          importance: 'medium',
        });
      }
    }
    if (m) {
      for (const h of m.holidays) {
        const short = !!h.hours;
        const name = lang === 'en' ? h.name : (HOLIDAY_JA[h.name] ?? h.name);
        items.push({
          date: h.date,
          timeET: null,
          key: 'HOL',
          label: short ? t(`${name}（短縮取引 ${h.hours.split('-')[1] ?? ''} まで）`, `${name} (early close ${h.hours.split('-')[1] ?? ''} ET)`) : t(`${name}（休場）`, `${name} (market closed)`),
          detail: short ? t('米国市場は短縮取引', 'US markets close early') : t('米国市場は休み', 'US markets closed'),
          importance: 'high',
        });
      }
    }
    const map = new Map<string, Item[]>();
    items
      .filter((i) => (daysUntil(i.date) ?? -1) >= 0)
      .sort((a, b) => (a.date + (a.timeET ?? '99')).localeCompare(b.date + (b.timeET ?? '99')))
      .forEach((i) => map.set(i.date, [...(map.get(i.date) ?? []), i]));
    return [...map.entries()].slice(0, 40);
  }, [econ, earnings, showEarnings, showMajor, lang, t]);

  return (
    <Card
      title={t('経済指標・決算カレンダー', 'Econ & earnings calendar')}
      className="flex min-h-0 min-w-0 flex-col"
      right={
        <span className="flex items-center gap-2">
          <label className="flex items-center gap-1 text-[11px] text-mute" title={t('ウォッチリストの銘柄の決算', 'Earnings of your watchlist')}>
            <input type="checkbox" checked={showEarnings} onChange={(e) => setShowEarnings(e.target.checked)} className="accent-indigo-400" />
            {t('決算', 'Earnings')}
          </label>
          {econ?.market && (
            <label className="flex items-center gap-1 text-[11px] text-mute" title={t('主要米国株（約 120 社）の決算と IPO', 'Earnings of ~120 major US stocks, and IPOs')}>
              <input type="checkbox" checked={showMajor} onChange={(e) => setShowMajor(e.target.checked)} className="accent-indigo-400" />
              {t('主要企業', 'Majors')}
            </label>
          )}
        </span>
      }
    >
      <div className="min-h-0 flex-1 overflow-auto px-2 py-1">
        {econError && <p className="p-2 text-xs text-downc">{econError}</p>}
        {econ?.warnings.map((w) => (
          <p key={w} className="mx-1 my-1 rounded bg-warnc/10 px-2 py-1 text-[11px] text-warnc">
            {w}
          </p>
        ))}
        {groups.map(([date, items]) => {
          const days = daysUntil(date)!;
          return (
            <div key={date} className="border-b border-line/50 py-1.5 last:border-0">
              <div className="mb-0.5 flex items-baseline justify-between px-1">
                <span className={`num text-xs font-semibold ${days <= 7 ? 'text-ink' : 'text-mute'}`}>{fmtDate(date)}</span>
                <span className={`text-[10px] ${days === 0 ? 'text-warnc' : 'text-mute'}`}>{days === 0 ? t('本日', 'Today') : t(`${days}日後`, `in ${days}d`)}</span>
              </div>
              {items.map((i, n) => {
                const local = i.timeET ? etToLocal(i.date, i.timeET) : null;
                const row = (
                  <div
                    onClick={i.click ? () => onSelect(i.click!) : undefined}
                    className={`flex items-center gap-1.5 rounded px-1 py-0.5 text-xs ${i.click ? 'cursor-pointer hover:bg-white/5' : ''}`}
                  >
                    <span className={`w-12 shrink-0 rounded px-1 text-center text-[10px] font-semibold ${KEY_COLOR[i.key] ?? KEY_COLOR.PPI}`}>
                      {i.key === 'EARN' || i.key === 'MEARN' ? t('決算', 'Earn') : i.key === 'RETAIL' ? t('小売', 'Retail') : i.key === 'NFP' ? t('雇用', 'Jobs') : i.key === 'HOL' ? t('休場', 'Closed') : i.key}
                    </span>
                    <span className={`min-w-0 flex-1 truncate ${i.importance === 'high' ? 'font-medium' : ''} ${i.key === 'MEARN' ? 'text-mute' : ''} ${i.key === 'HOL' ? 'text-rose-300' : ''}`} title={i.detail}>
                      {i.label}
                      {i.importance === 'high' && i.key !== 'HOL' && <span className="ml-1 text-warnc">★</span>}
                    </span>
                    {local && (
                      <span className="num shrink-0 text-[10px] text-mute" title={t(`米東部時間 ${i.timeET}`, `${i.timeET} ET`)}>
                        {local.time}
                        {local.dayShift ? '+1' : ''}
                      </span>
                    )}
                  </div>
                );
                const fed = i.key === 'FOMC' ? econ?.fed?.meetings.find((m) => m.date === i.date) : undefined;
                return (
                  <div key={n}>
                    {row}
                    {fed && <FedBar m={fed} />}
                  </div>
                );
              })}
            </div>
          );
        })}
        {!groups.length && !econError && <p className="p-2 text-xs text-mute">{t('予定はありません', 'Nothing scheduled')}</p>}
      </div>
      <p className="border-t border-line px-3 py-1 text-[10px] text-mute">{t(`時刻は閲覧中の現地時間（${localTzLabel()}）。★=市場への影響が大きい指標`, `Times in your local zone (${localTzLabel()}). ★ = high market impact`)}</p>
    </Card>
  );
}
