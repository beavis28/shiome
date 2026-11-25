import type { Derived, StockState } from '../lib/derive';
import { daysUntil, fmtBig, fmtDate, fmtPct, fmtPrice } from '../lib/format';
import type { PriceTarget } from '../types';
import { AnalystCards } from './AnalystCards';
import { PriceChart } from './PriceChart';
import { Badge, Card, changeColor } from './ui';
import { useT } from '../lib/i18n';
import { extLabel, feedLabel } from '../lib/names';

function TargetBar({ pt, price, d }: { pt: PriceTarget; price: number; d: Derived }) {
  const { t } = useT();
  const vals = [pt.low, pt.high, price].filter((v): v is number => v !== null);
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const pos = (v: number) => `${((v - min) / (max - min || 1)) * 100}%`;
  return (
    <div className="px-3 pb-2 pt-1">
      <div className="flex flex-wrap items-baseline gap-x-2">
        <span className="text-[11px] text-mute">{t('平均', 'Mean')}</span>
        <span className="num text-lg font-semibold">{fmtPrice(pt.mean)}</span>
        <span className={`num whitespace-nowrap text-sm font-semibold ${changeColor(d.upside)}`}>{fmtPct(d.upside)}</span>
        <span className="num ml-auto whitespace-nowrap text-[11px] text-mute">{t('中央値', 'Median')} {fmtPrice(pt.median)}</span>
      </div>
      <div className="relative mb-1 mt-3 h-1.5 rounded-full bg-gradient-to-r from-downc/50 via-white/15 to-upc/50">
        {pt.mean !== null && <div className="absolute -top-1 h-3.5 w-0.5 bg-sky-400" style={{ left: pos(pt.mean) }} title={t('平均', 'Mean')} />}
        <div className="absolute -top-1.5 h-4.5 w-4.5 -translate-x-1/2 rounded-full border-2 border-bg bg-ink" style={{ left: pos(price) }} title={t('現在値', 'Current price')} />
      </div>
      <div className="num flex justify-between gap-2 whitespace-nowrap text-[11px]">
        <span>
          <span className="text-mute">{t('安値', 'Low')} </span>
          {fmtPrice(pt.low)} <span className={changeColor(d.upsideLow)}>{fmtPct(d.upsideLow)}</span>
        </span>
        <span>
          <span className="text-mute">{t('高値', 'High')} </span>
          {fmtPrice(pt.high)} <span className={changeColor(d.upsideHigh)}>{fmtPct(d.upsideHigh)}</span>
        </span>
      </div>
    </div>
  );
}

export function DetailPanel({ symbol, state, d }: { symbol: string; state?: StockState; d?: Derived }) {
  const { t, lang } = useT();
  const p = state?.data;
  if (!p || !d) {
    return (
      <div className="flex h-full items-center justify-center rounded-lg border border-line bg-panel text-sm text-mute">
        {state?.error ? `${symbol}: ${state.error}` : t(`${symbol} を読み込み中…`, `Loading ${symbol}…`)}
      </div>
    );
  }
  const q = p.quote.data;
  const e = p.earnings.data;
  const days = daysUntil(e?.date);
  const bars = d.bars;

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      {/* 上段: 銘柄・現在値 / ターゲット価格 / 決算 */}
      <div className="grid grid-cols-1 gap-2 md:grid-cols-[1fr_1.4fr_0.75fr]">
        <Card className="px-3 py-2">
          <div className="flex items-baseline gap-2">
            <h1 className="text-xl font-bold">{symbol}</h1>
            <span className="truncate text-xs text-mute">{q?.name}</span>
            {p.demo && <Badge tone="warn">{t('デモ', 'Demo')}</Badge>}
            {q?.feed && (
              <span className="ml-auto shrink-0">
                <Badge tone={q.realtime ? 'up' : 'neutral'} title={q.time ? t(`価格時刻 ${new Date(q.time).toLocaleString('ja-JP')}`, `Price as of ${new Date(q.time).toLocaleString('en-US')}`) : undefined}>
                  {q.realtime && <i className="mr-1 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-upc" />}
                  {feedLabel(q, lang)}
                </Badge>
              </span>
            )}
          </div>
          {q ? (
            <>
              <div className="mt-0.5 flex items-baseline gap-2">
                <span className="num text-2xl font-semibold">{fmtPrice(q.price)}</span>
                <span className={`num text-sm font-medium ${changeColor(q.change)}`}>
                  {q.change > 0 ? '+' : ''}
                  {q.change.toFixed(2)} ({fmtPct(q.changePercent, 2)})
                </span>
              </div>
              {q.extPrice != null && (
                <div className="num text-[11px] text-mute">
                  {extLabel(q, lang)} <span className="text-ink">{fmtPrice(q.extPrice)}</span>{' '}
                  <span className={changeColor(q.extChangePercent)}>{fmtPct(q.extChangePercent, 2)}</span>
                </div>
              )}
              <dl className="num mt-1 grid grid-cols-2 gap-x-3 text-[11px]">
                <dt className="text-mute">{t('日中', 'Day')}</dt>
                <dd className="text-right">{fmtPrice(q.dayLow)} – {fmtPrice(q.dayHigh)}</dd>
                <dt className="text-mute">{t('52週', '52-wk')}</dt>
                <dd className="text-right">{fmtPrice(q.yearLow)} – {fmtPrice(q.yearHigh)}</dd>
                <dt className="text-mute">{t('時価総額', 'Market cap')}</dt>
                <dd className="text-right">{fmtBig(q.marketCap)}</dd>
              </dl>
            </>
          ) : (
            <p className="mt-2 text-xs text-downc">{p.quote.error}</p>
          )}
        </Card>

        <Card
          title={t('アナリスト目標価格', 'Analyst targets')}
          right={
            <span className="text-[10px] text-mute">
              {p.target.data?.analysts ? t(`${p.target.data.analysts}人 · `, `${p.target.data.analysts} analysts · `) : ''}
              {p.target.source ?? ''}
            </span>
          }
        >
          {p.target.data && d.price ? (
            <TargetBar pt={p.target.data} price={d.price} d={d} />
          ) : (
            <p className="p-3 text-xs text-mute">{p.target.error ?? t('データなし', 'No data')}</p>
          )}
        </Card>

        <Card title={t('次回決算発表', 'Next earnings')} right={<span className="text-[10px] text-mute">{p.earnings.source ?? ''}</span>}>
          <div className="px-3 py-2">
            {e?.date ? (
              <>
                <div className="num text-xl font-semibold">{fmtDate(e.date)}</div>
                <div className={`text-sm ${days !== null && days <= 7 ? 'text-warnc' : 'text-mute'}`}>
                  {days === 0 ? t('本日', 'Today') : t(`あと ${days} 日`, `in ${days} days`)}
                  <span className="ml-1 text-[11px] text-mute">{e.date.slice(0, 4)}</span>
                  {e.estimate && <span className="ml-1 text-[10px] text-warnc" title={t('会社が正式発表する前の推定日', 'Estimated date, before the company confirms')}>{t('推定', 'est.')}</span>}
                </div>
                <div className="num mt-1 text-[11px] text-mute">{t('予想EPS', 'EPS est.')} {e.epsEstimated ?? '—'}</div>
              </>
            ) : (
              <p className="text-xs text-mute">{p.earnings.error ?? t('予定日は未発表', 'Date not announced')}</p>
            )}
          </div>
        </Card>
      </div>

      {/* テクニカル指標バッジ */}
      <Card className="flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-1.5">
        <span className="text-xs font-semibold text-mute">{t('テクニカル', 'Technicals')}</span>
        {d.tech ? (
          d.tech.signals.map((s) => (
            <span key={s.key} className="flex items-center gap-1.5 text-xs" title={s.hint}>
              <span className="text-mute">{s.label}</span>
              <Badge tone={s.tone}>{s.value}</Badge>
            </span>
          ))
        ) : (
          <span className="text-xs text-mute">{p.history.error ?? t('価格履歴が不足しています', 'Not enough price history')}</span>
        )}
      </Card>

      {/* アナリスト・需給（折りたたみ可） */}
      <AnalystCards symbol={symbol} />

      {/* チャート */}
      <Card className="flex min-h-[420px] flex-1 flex-col md:min-h-0">
        {d.tech && bars.length ? (
          <PriceChart bars={bars} tech={d.tech} target={p.target.data?.mean} />
        ) : (
          <p className="p-4 text-xs text-mute">{t('チャートを表示できません', 'Chart unavailable')}</p>
        )}
      </Card>
    </div>
  );
}
