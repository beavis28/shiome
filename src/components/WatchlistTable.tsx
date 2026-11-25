import { useMemo, useState } from 'react';
import type { Derived, StockState } from '../lib/derive';
import { daysUntil, fmtDate, fmtPct, fmtPrice } from '../lib/format';
import { TickerAdd } from './TickerAdd';
import { Badge, Card, changeColor } from './ui';

type SortKey = 'symbol' | 'change' | 'upside' | 'rsi' | 'earnings';

interface Props {
  symbols: string[];
  states: Record<string, StockState>;
  derived: Record<string, Derived>;
  selected: string | null;
  onSelect: (s: string) => void;
  onRemove: (s: string) => void;
  onAdd: (s: string) => void;
  /** 比較モードのとき、比較に含める銘柄のチェック */
  compare?: { checked: string[]; toggle: (s: string) => void };
}

export function WatchlistTable({ symbols, states, derived, selected, onSelect, onRemove, onAdd, compare }: Props) {
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 } | null>(null);

  const rows = useMemo(() => {
    const val = (s: string): number | string | null => {
      const st = states[s]?.data;
      const d = derived[s];
      switch (sort?.key) {
        case 'change':
          return st?.quote.data?.changePercent ?? null;
        case 'upside':
          return d?.upside ?? null;
        case 'rsi':
          return d?.tech?.last.rsi ?? null;
        case 'earnings':
          return daysUntil(st?.earnings.data?.date);
        default:
          return s;
      }
    };
    if (!sort) return symbols;
    return [...symbols].sort((a, b) => {
      const va = val(a);
      const vb = val(b);
      if (va === null) return 1;
      if (vb === null) return -1;
      return (va < vb ? -1 : va > vb ? 1 : 0) * sort.dir;
    });
  }, [symbols, states, derived, sort]);

  const th = (key: SortKey, label: string, cls = '') => (
    <th
      className={`cursor-pointer select-none px-1 py-1.5 md:px-2 font-medium hover:text-ink ${cls}`}
      onClick={() => setSort((s) => (s?.key === key ? (s.dir === 1 ? { key, dir: -1 } : null) : { key, dir: key === 'symbol' || key === 'earnings' ? 1 : -1 }))}
    >
      {label}
      {sort?.key === key ? (sort.dir === 1 ? ' ▲' : ' ▼') : ''}
    </th>
  );

  return (
    <Card
      title={`ウォッチリスト（${symbols.length}）`}
      className="flex min-h-0 flex-col"
      right={
        <TickerAdd symbols={symbols} onAdd={onAdd} onRemove={onRemove} />
      }
    >
      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-full text-xs">
          <thead className="sticky top-0 z-10 bg-panel text-left text-[11px] text-mute">
            <tr>
              {th('symbol', '銘柄')}
              {th('change', '現在値', 'text-right')}
              {th('upside', '目標乖離', 'text-right')}
              {th('rsi', 'RSI', 'text-center')}
              {th('earnings', '決算', 'text-right')}
            </tr>
          </thead>
          <tbody>
            {rows.map((s) => {
              const st = states[s];
              const p = st?.data;
              const q = p?.quote.data;
              const d = derived[s];
              const r = d?.tech?.last.rsi ?? null;
              const macdSig = d?.tech?.signals.find((x) => x.key === 'macd');
              const days = daysUntil(p?.earnings.data?.date);
              const active = s === selected;
              return (
                <tr
                  key={s}
                  onClick={() => onSelect(s)}
                  className={`group cursor-pointer border-t border-line/60 ${active ? 'bg-accent/10' : 'hover:bg-white/[0.03]'}`}
                >
                  <td className={`px-1 py-1.5 md:px-2 ${active ? 'border-l-2 border-accent' : 'border-l-2 border-transparent'}`}>
                    <div className="flex items-center gap-1">
                      {compare && (
                        <input
                          type="checkbox"
                          aria-label={`${s} を比較に含める`}
                          checked={compare.checked.includes(s)}
                          onClick={(e) => e.stopPropagation()}
                          onChange={() => compare.toggle(s)}
                          className="mr-1 accent-sky-400"
                        />
                      )}
                      <span className="font-semibold">{s}</span>
                      <button
                        title="ウォッチリストから外す"
                        onClick={(e) => {
                          e.stopPropagation();
                          onRemove(s);
                        }}
                        className="ml-auto hidden px-1 text-mute hover:text-downc group-hover:inline"
                      >
                        ×
                      </button>
                    </div>
                    <div className="max-w-[80px] truncate md:max-w-[110px] text-[10px] text-mute">{st?.loading ? '読み込み中…' : st?.error ? st.error : (q?.name ?? '')}</div>
                  </td>
                  <td className="num px-1 py-1.5 md:px-2 text-right">
                    <div>{fmtPrice(d?.price)}</div>
                    <div className={`text-[10px] ${changeColor(q?.changePercent)}`}>{fmtPct(q?.changePercent, 2)}</div>
                  </td>
                  <td className={`num px-1 py-1.5 md:px-2 text-right ${changeColor(d?.upside)}`}>
                    {d?.upside !== null && d?.upside !== undefined ? fmtPct(d.upside) : <span className="text-mute">—</span>}
                  </td>
                  <td className="px-1 py-1.5 md:px-2 text-center">
                    <div className="flex flex-col items-center gap-0.5">
                      {r === null ? (
                        <span className="text-mute">—</span>
                      ) : (
                        <Badge tone={r >= 70 ? 'down' : r <= 30 ? 'up' : 'neutral'} title={r >= 70 ? '買われすぎ' : r <= 30 ? '売られすぎ' : '中立'}>
                          {r.toFixed(0)}
                        </Badge>
                      )}
                      {macdSig && <span className={`text-[9px] ${macdSig.tone === 'up' ? 'text-upc' : 'text-downc'}`}>MACD{macdSig.tone === 'up' ? '↑' : '↓'}</span>}
                    </div>
                  </td>
                  <td className="num whitespace-nowrap px-1 py-1.5 md:px-2 text-right">
                    <div>{fmtDate(p?.earnings.data?.date)}</div>
                    {days !== null && <div className={`text-[10px] ${days <= 7 ? 'text-warnc' : 'text-mute'}`}>{days === 0 ? '本日' : `あと${days}日`}</div>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!symbols.length && <p className="p-4 text-center text-xs text-mute">「写真から取り込み」かティッカー入力で銘柄を追加してください</p>}
      </div>
    </Card>
  );
}
