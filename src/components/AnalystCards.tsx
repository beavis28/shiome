// 詳細画面の「アナリスト・需給」: 評価の変更（格上げ・格下げ）、業績予想の修正、空売り
// 1 枚のカードにタブでまとめ、見出しに要点（格上げ・格下げの数、予想の修正、空売り比率）を出す
import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { fmtBig, fmtPct } from '../lib/format';
import { useT } from '../lib/i18n';
import type { AnalystData } from '../types';
import { Badge, Card, changeColor } from './ui';

type Tab = 'ratings' | 'estimates' | 'short';
const KEY = 'shiome.analyst.tab';
const readTab = (): Tab | 'closed' => {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'estimates' || v === 'short' || v === 'closed' ? v : 'ratings';
  } catch {
    return 'ratings';
  }
};

const md = (d: string | null) => (d ? `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}` : '—');
const chg = (now: number | null, before: number | null) => (now !== null && before ? ((now - before) / Math.abs(before)) * 100 : null);
const since = (days: number) => new Date(Date.now() - days * 86400_000).toISOString().slice(0, 10);

function summary(a: AnalystData) {
  const recent = a.ratings.filter((r) => r.date >= since(90));
  const q = a.estimates.find((e) => e.period === '0y') ?? a.estimates[0];
  return {
    ups: recent.filter((r) => r.action === 'up').length,
    downs: recent.filter((r) => r.action === 'down').length,
    eps30: q ? chg(q.eps, q.eps30d) : null,
    short: a.short?.pctFloat ?? null,
  };
}

function Ratings({ a }: { a: AnalystData }) {
  const { t } = useT();
  const recent = a.ratings.filter((r) => r.date >= since(90));
  const ptUp = recent.filter((r) => r.pt && r.priorPt && r.pt > r.priorPt).length;
  const ptDown = recent.filter((r) => r.pt && r.priorPt && r.pt < r.priorPt).length;
  const rec = a.recommendation[0];
  const recTotal = rec ? rec.strongBuy + rec.buy + rec.hold + rec.sell + rec.strongSell : 0;
  return (
    <div className="grid grid-cols-1 gap-x-4 md:grid-cols-[minmax(0,1fr)_180px]">
      <ul className="max-h-[132px] overflow-auto py-0.5 text-[11px]">
        {a.ratings.map((r, i) => (
          <li key={i} className="flex items-center gap-1.5 rounded px-1.5 py-0.5" title={`${r.firm}: ${r.from || '—'} → ${r.to}${r.pt ? ` / PT ${r.priorPt ?? '—'} → ${r.pt}` : ''}`}>
            <span className="num w-9 shrink-0 text-mute">{md(r.date)}</span>
            <span className="min-w-0 flex-1 truncate">{r.firm}</span>
            {r.action === 'up' || r.action === 'down' ? (
              <Badge tone={r.action === 'up' ? 'up' : 'down'}>
                {r.action === 'up' ? '↑' : '↓'} {r.to}
              </Badge>
            ) : (
              <span className="max-w-[90px] shrink-0 truncate text-[10px] text-mute">{r.action === 'init' ? t(`新規 ${r.to}`, `Init ${r.to}`) : r.to}</span>
            )}
            <span className={`num w-[64px] shrink-0 text-right ${r.pt && r.priorPt ? changeColor(r.pt - r.priorPt) : 'text-mute'}`}>
              {r.pt === null ? '' : `${r.priorPt && r.priorPt !== r.pt ? `${r.priorPt}→` : ''}${r.pt}`}
            </span>
          </li>
        ))}
        {!a.ratings.length && <li className="px-1.5 py-1 text-mute">{t('直近 1 年の変更はありません', 'No changes in the last year')}</li>}
      </ul>
      <div className="border-line/50 py-1 text-[11px] max-md:border-t md:border-l md:pl-3">
        <div className="text-[10px] text-mute">{t('直近 90 日', 'Last 90 days')}</div>
        <div className="flex gap-3">
          <span>
            {t('格上げ', 'Upgrades')} <b className="num text-upc">{recent.filter((r) => r.action === 'up').length}</b>
          </span>
          <span>
            {t('格下げ', 'Downgrades')} <b className="num text-downc">{recent.filter((r) => r.action === 'down').length}</b>
          </span>
        </div>
        <div>
          {t('目標価格', 'Targets')} <span className="num text-upc">↑{ptUp}</span> <span className="num text-downc">↓{ptDown}</span>
        </div>
        {rec && recTotal > 0 && (
          <div className="mt-1" title={t('今月のアナリストの推奨の内訳', "This month's analyst recommendations")}>
            <div className="flex h-1.5 overflow-hidden rounded-full">
              {(
                [
                  [rec.strongBuy + rec.buy, 'bg-upc'],
                  [rec.hold, 'bg-white/25'],
                  [rec.sell + rec.strongSell, 'bg-downc'],
                ] as const
              ).map(([v, c], i) => v > 0 && <i key={i} className={c} style={{ width: `${(v / recTotal) * 100}%` }} />)}
            </div>
            <div className="mt-0.5 flex justify-between text-[10px] text-mute">
              <span>
                {t('買い', 'Buy')} {rec.strongBuy + rec.buy}
              </span>
              <span>
                {t('中立', 'Hold')} {rec.hold}
              </span>
              <span>
                {t('売り', 'Sell')} {rec.sell + rec.strongSell}
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Estimates({ a }: { a: AnalystData }) {
  const { t } = useT();
  const name: Record<string, [string, string]> = { '0q': ['今期', 'This qtr'], '+1q': ['来期', 'Next qtr'], '0y': ['今年度', 'This FY'], '+1y': ['来年度', 'Next FY'] };
  return (
    <div className="overflow-x-auto">
      <table className="w-full whitespace-nowrap text-[11px]">
        <thead className="text-[10px] text-mute">
          <tr>
            <th className="px-2 py-0.5 text-left font-normal" />
            <th className="px-1 py-0.5 text-right font-normal">{t('予想 EPS', 'EPS est.')}</th>
            <th className="px-1 py-0.5 text-right font-normal">{t('30日前比', 'vs 30d')}</th>
            <th className="px-1 py-0.5 text-right font-normal">{t('90日前比', 'vs 90d')}</th>
            <th className="px-1 py-0.5 text-right font-normal" title={t('直近 30 日に予想を上げた・下げたアナリストの数', 'Analysts who raised / cut estimates in the last 30 days')}>
              {t('上げ / 下げ', 'Up / down')}
            </th>
            <th className="px-2 py-0.5 text-right font-normal">{t('前年比', 'YoY')}</th>
          </tr>
        </thead>
        <tbody>
          {a.estimates.map((e) => {
            const c30 = chg(e.eps, e.eps30d);
            const c90 = chg(e.eps, e.eps90d);
            return (
              <tr key={e.period} className="border-t border-line/40" title={e.endDate ? t(`${e.endDate} 締め・${e.analysts ?? '—'}人`, `Period ending ${e.endDate}, ${e.analysts ?? '—'} analysts`) : undefined}>
                <td className="px-2 py-0.5 text-mute">{t(...(name[e.period] ?? [e.period, e.period]))}</td>
                <td className="num px-1 py-0.5 text-right">{e.eps?.toFixed(2) ?? '—'}</td>
                <td className={`num px-1 py-0.5 text-right ${changeColor(c30 !== null && Math.abs(c30) >= 0.05 ? c30 : 0)}`}>{fmtPct(c30)}</td>
                <td className={`num px-1 py-0.5 text-right ${changeColor(c90 !== null && Math.abs(c90) >= 0.05 ? c90 : 0)}`}>{fmtPct(c90)}</td>
                <td className="num px-1 py-0.5 text-right">
                  <span className="text-upc">↑{e.up30 ?? 0}</span> <span className="text-downc">↓{e.down30 ?? 0}</span>
                </td>
                <td className="num px-2 py-0.5 text-right">{e.growth === null ? '—' : fmtPct(e.growth * 100)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {a.surprises.length > 0 && (
        <div className="flex flex-wrap items-center gap-1 border-t border-line/50 px-2 py-1 text-[10px]">
          <span className="text-mute">{t('過去の決算サプライズ', 'Past earnings surprises')}</span>
          {a.surprises.map((s, i) => (
            <span
              key={i}
              title={t(`${s.quarter ?? ''} 実績 ${s.actual ?? '—'} / 予想 ${s.estimate?.toFixed(2) ?? '—'}`, `${s.quarter ?? ''} actual ${s.actual ?? '—'} / est. ${s.estimate?.toFixed(2) ?? '—'}`)}
              className={`num rounded px-1 ring-1 ring-inset ${(s.surprisePct ?? 0) >= 0 ? 'text-upc ring-upc/30' : 'text-downc ring-downc/30'}`}
            >
              {fmtPct(s.surprisePct === null ? null : s.surprisePct * 100)}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function Short({ a }: { a: AnalystData }) {
  const { t } = useT();
  const s = a.short;
  if (!s) return <p className="p-2 text-[11px] text-mute">{t('データがありません', 'No data')}</p>;
  const diff = s.shares && s.prior ? ((s.shares - s.prior) / s.prior) * 100 : null;
  const level = s.pctFloat == null ? null : s.pctFloat >= 0.2 ? 'high' : s.pctFloat >= 0.1 ? 'mid' : 'low';
  const cell = (label: string, value: React.ReactNode, hint?: string) => (
    <div title={hint}>
      <div className="text-[10px] text-mute">{label}</div>
      <div className="num text-sm font-semibold">{value}</div>
    </div>
  );
  return (
    <div className="px-2 py-1">
      <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 sm:grid-cols-4">
        {cell(
          t('浮動株に対する割合', '% of float'),
          <>
            {s.pctFloat != null ? `${(s.pctFloat * 100).toFixed(1)}%` : '—'}{' '}
            {level && <Badge tone={level === 'high' ? 'warn' : 'neutral'}>{level === 'high' ? t('高い', 'High') : level === 'mid' ? t('やや高い', 'Elevated') : t('低い', 'Low')}</Badge>}
          </>,
        )}
        {cell(t('買い戻し日数', 'Days to cover'), s.daysToCover?.toFixed(1) ?? '—', t('空売りの株数 ÷ 1 日の平均出来高。買い戻しにかかる日数の目安', 'Shares short ÷ average daily volume: rough days needed to cover'))}
        {cell(t('空売りの株数', 'Shares short'), fmtBig(s.shares))}
        {diff !== null && cell(t('前回比', 'vs prior'), <span className={changeColor(diff)}>{fmtPct(diff)}</span>)}
      </div>
      <p className="mt-1.5 text-[10px] text-mute">
        {t(`取引所の集計（月 2 回・約 2 週間遅れ）。${md(s.date)} 時点。`, `Exchange data, twice a month, about 2 weeks behind. As of ${md(s.date)}.`)}
        {t('浮動株の 10% を超えると高めとされます。', ' Above 10% of float is usually considered high.')}
      </p>
    </div>
  );
}

/** 詳細画面のアナリスト・需給（タブ切り替え・折りたたみ可） */
export function AnalystCards({ symbol }: { symbol: string }) {
  const { t } = useT();
  const [tab, setTab] = useState<Tab | 'closed'>(readTab);
  const [state, setState] = useState<{ symbol: string; data: AnalystData | null; error: string | null } | null>(null);
  useEffect(() => {
    try {
      localStorage.setItem(KEY, tab);
    } catch {
      /* 無視 */
    }
  }, [tab]);
  useEffect(() => {
    let alive = true;
    api.analyst(symbol).then(
      (d) => alive && setState({ symbol, data: d, error: null }),
      (e) => alive && setState({ symbol, data: null, error: e instanceof Error ? e.message : String(e) }),
    );
    return () => {
      alive = false;
    };
  }, [symbol]);
  const s = state?.symbol === symbol ? state : null;
  const sum = s?.data ? summary(s.data) : null;
  const tabs: [Tab, string, React.ReactNode][] = [
    [
      'ratings',
      t('評価の変更', 'Ratings'),
      sum && (
        <>
          <span className="text-upc">↑{sum.ups}</span> <span className="text-downc">↓{sum.downs}</span>
        </>
      ),
    ],
    ['estimates', t('EPS 予想', 'EPS est.'), sum?.eps30 != null && <span className={changeColor(Math.abs(sum.eps30) >= 0.05 ? sum.eps30 : 0)}>{fmtPct(sum.eps30)}</span>],
    ['short', t('空売り', 'Short'), sum?.short != null && <span>{(sum.short * 100).toFixed(1)}%</span>],
  ];
  return (
    <Card className="shrink-0">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 px-2 py-1">
        <button
          onClick={() => setTab((v) => (v === 'closed' ? 'ratings' : 'closed'))}
          aria-expanded={tab !== 'closed'}
          className="flex items-center gap-1 text-xs font-semibold text-mute hover:text-ink"
        >
          <span className="text-[9px]">{tab === 'closed' ? '▸' : '▾'}</span>
          {t('アナリスト・需給', 'Analysts & shorts')}
        </button>
        <span className="flex overflow-hidden rounded-md border border-line text-[11px]" role="tablist">
          {tabs.map(([k, label, badge]) => (
            <button
              key={k}
              role="tab"
              aria-selected={tab === k}
              onClick={() => setTab(k)}
              className={`flex items-center gap-1.5 whitespace-nowrap border-l border-line px-2 py-0.5 first:border-l-0 ${tab === k ? 'bg-accent/15 text-accent' : 'text-mute hover:bg-white/5 hover:text-ink'}`}
            >
              {label}
              {badge && <span className="num text-[10px]">{badge}</span>}
            </button>
          ))}
        </span>
        {tab === 'ratings' && <span className="ml-auto text-[10px] text-mute">{t('直近 1 年 · Yahoo Finance', 'Last 12 months · Yahoo Finance')}</span>}
      </div>
      {tab !== 'closed' && (
        <div className="border-t border-line/60 px-1 py-1">
          {s?.data ? (
            tab === 'ratings' ? (
              <Ratings a={s.data} />
            ) : tab === 'estimates' ? (
              <Estimates a={s.data} />
            ) : (
              <Short a={s.data} />
            )
          ) : (
            <p className="p-2 text-[11px] text-mute">{s?.error ?? t('読み込み中…', 'Loading…')}</p>
          )}
        </div>
      )}
    </Card>
  );
}
