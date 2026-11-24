import { useMemo, useState } from 'react';
import { daysUntil, etToLocal, fmtDate, localTzLabel } from '../lib/format';
import type { EconPayload } from '../types';
import { Card } from './ui';

interface Item {
  date: string;
  timeET: string | null;
  key: string;
  label: string;
  detail?: string;
  importance: 'high' | 'medium' | 'earnings';
}

const KEY_COLOR: Record<string, string> = {
  FOMC: 'bg-fuchsia-500/20 text-fuchsia-300',
  CPI: 'bg-orange-500/20 text-orange-300',
  NFP: 'bg-sky-500/20 text-sky-300',
  PCE: 'bg-amber-500/20 text-amber-300',
  GDP: 'bg-emerald-500/20 text-emerald-300',
  PPI: 'bg-slate-500/25 text-slate-300',
  RETAIL: 'bg-slate-500/25 text-slate-300',
  EARN: 'bg-indigo-500/25 text-indigo-300',
};

interface Props {
  econ: EconPayload | null;
  econError: string | null;
  earnings: { symbol: string; date: string }[];
  onSelect: (s: string) => void;
}

export function EconCalendar({ econ, econError, earnings, onSelect }: Props) {
  const [showEarnings, setShowEarnings] = useState(true);
  const groups = useMemo(() => {
    const items: Item[] = (econ?.events ?? []).map((e) => ({ ...e }));
    if (showEarnings) {
      for (const e of earnings) items.push({ date: e.date, timeET: null, key: 'EARN', label: e.symbol, detail: '決算発表', importance: 'earnings' });
    }
    const map = new Map<string, Item[]>();
    items
      .filter((i) => (daysUntil(i.date) ?? -1) >= 0)
      .sort((a, b) => (a.date + (a.timeET ?? '99')).localeCompare(b.date + (b.timeET ?? '99')))
      .forEach((i) => map.set(i.date, [...(map.get(i.date) ?? []), i]));
    return [...map.entries()].slice(0, 40);
  }, [econ, earnings, showEarnings]);

  return (
    <Card
      title="経済指標・決算カレンダー"
      className="flex min-h-0 min-w-0 flex-col"
      right={
        <label className="flex items-center gap-1 text-[11px] text-mute">
          <input type="checkbox" checked={showEarnings} onChange={(e) => setShowEarnings(e.target.checked)} className="accent-indigo-400" />
          決算
        </label>
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
                <span className={`text-[10px] ${days === 0 ? 'text-warnc' : 'text-mute'}`}>{days === 0 ? '本日' : `${days}日後`}</span>
              </div>
              {items.map((i, n) => {
                const local = i.timeET ? etToLocal(i.date, i.timeET) : null;
                return (
                  <div
                    key={n}
                    onClick={i.key === 'EARN' ? () => onSelect(i.label) : undefined}
                    className={`flex items-center gap-1.5 rounded px-1 py-0.5 text-xs ${i.key === 'EARN' ? 'cursor-pointer hover:bg-white/5' : ''}`}
                  >
                    <span className={`w-12 shrink-0 rounded px-1 text-center text-[10px] font-semibold ${KEY_COLOR[i.key] ?? KEY_COLOR.PPI}`}>
                      {i.key === 'EARN' ? '決算' : i.key === 'RETAIL' ? '小売' : i.key === 'NFP' ? '雇用' : i.key}
                    </span>
                    <span className={`min-w-0 flex-1 truncate ${i.importance === 'high' ? 'font-medium' : ''}`} title={i.detail}>
                      {i.label}
                      {i.importance === 'high' && <span className="ml-1 text-warnc">★</span>}
                    </span>
                    {local && (
                      <span className="num shrink-0 text-[10px] text-mute" title={`米東部時間 ${i.timeET}`}>
                        {local.time}
                        {local.dayShift ? '+1' : ''}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          );
        })}
        {!groups.length && !econError && <p className="p-2 text-xs text-mute">予定はありません</p>}
      </div>
      <p className="border-t border-line px-3 py-1 text-[10px] text-mute">時刻は閲覧中の現地時間（{localTzLabel()}）。★=市場への影響が大きい指標</p>
    </Card>
  );
}
