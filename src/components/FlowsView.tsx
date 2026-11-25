// 大口投資家の売買: 有名投資家の保有（SEC 13F）・役員の売買（Form 4）・議員の売買（STOCK Act）
// どれも公開まで時間がかかる届け出なので、いつの時点のデータかを必ず表示する
import { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';
import { fmtBig, fmtDate } from '../lib/format';
import { useT, type Lang } from '../lib/i18n';
import { managerName } from '../lib/names';
import type { CongressTrade, FundHoldings, FundPosition, FundSummary, Ownership } from '../types';
import { Badge, Card } from './ui';

type Tab = 'stock' | 'funds' | 'congress';
const BAR = '#3b82f6';

// 13F は一度取れば数日変わらないので、画面を切り替えても取り直さない
const fundCache = new Map<string, Promise<FundHoldings>>();
const loadFund = (cik: string) => {
  let p = fundCache.get(cik);
  if (!p) {
    p = api.fund(cik);
    p.catch(() => fundCache.delete(cik));
    fundCache.set(cik, p);
  }
  return p;
};

/** 全ファンドを 2 件ずつ順番に読み込む（取れた順に表示を更新） */
function useAllFunds(funds: FundSummary[] | null, active: boolean) {
  const [data, setData] = useState<Record<string, FundHoldings | string>>({});
  useEffect(() => {
    if (!funds || !active) return;
    let alive = true;
    const queue = [...funds];
    const worker = async () => {
      for (let f = queue.shift(); f && alive; f = queue.shift()) {
        const cik = f.cik;
        await loadFund(cik).then(
          (h) => alive && setData((d) => ({ ...d, [cik]: h })),
          (e) => alive && setData((d) => ({ ...d, [cik]: e instanceof Error ? e.message : String(e) })),
        );
      }
    };
    void Promise.all([worker(), worker()]);
    return () => {
      alive = false;
    };
  }, [funds, active]);
  return data;
}

const CHANGE: Record<FundPosition['change'], { label: { ja: string; en: string }; tone: 'up' | 'down' | 'neutral' | 'warn' }> = {
  new: { label: { ja: '新規', en: 'New' }, tone: 'up' },
  add: { label: { ja: '買い増し', en: 'Added' }, tone: 'up' },
  reduce: { label: { ja: '一部売却', en: 'Trimmed' }, tone: 'down' },
  sold: { label: { ja: '全売却', en: 'Sold out' }, tone: 'down' },
  same: { label: { ja: '変わらず', en: 'Unchanged' }, tone: 'neutral' },
};

function ChangeBadge({ p }: { p: FundPosition }) {
  const { t, lang } = useT();
  const c = CHANGE[p.change];
  const diff = p.prevShares && p.change !== 'sold' && p.change !== 'new' ? ((p.shares - p.prevShares) / p.prevShares) * 100 : null;
  return (
    <Badge tone={c.tone} title={p.prevShares !== null ? t(`前の期 ${p.prevShares.toLocaleString('en-US')} 株`, `Prev qtr: ${p.prevShares.toLocaleString('en-US')} sh`) : undefined}>
      {c.label[lang]}
      {diff !== null && Math.abs(diff) >= 0.5 && ` ${diff > 0 ? '+' : ''}${diff.toFixed(0)}%`}
    </Badge>
  );
}

const pct = (v: number | null | undefined, d = 1) => (v === null || v === undefined ? '—' : `${(v * 100).toFixed(d)}%`);
const usd = (v: number | null | undefined) => (v === null || v === undefined ? '—' : `$${fmtBig(v)}`);
/** 四半期末の表示（日本語「2026年3Q末」/ 英語「Q3 2026」） */
const quarterEnd = (date: string, lang: Lang) => {
  const y = date.slice(0, 4);
  const q = Math.ceil(Number(date.slice(5, 7)) / 3);
  return lang === 'en' ? `Q${q} ${y}` : `${y}年${q}Q末`;
};

function Ticker({ p, onPick, watch }: { p: FundPosition; onPick: (s: string) => void; watch: Set<string> }) {
  const { t } = useT();
  return (
    <span className="flex min-w-0 items-baseline gap-1.5">
      {p.ticker ? (
        <button onClick={() => onPick(p.ticker!)} className="font-semibold text-accent hover:underline" title={t('詳細を見る', 'View details')}>
          {p.ticker}
        </button>
      ) : null}
      {p.ticker && watch.has(p.ticker) && <span className="text-[10px] text-warnc" title={t('ウォッチリストにある銘柄', 'In your watchlist')}>★</span>}
      <span className={`truncate text-[11px] ${p.ticker ? 'text-mute max-md:hidden' : 'text-ink'}`} title={`${p.name}（${p.cls}）`}>
        {p.name}
        {p.putCall && <span className="ml-1 text-warnc">{p.putCall === 'Put' ? t('プット', 'Put') : t('コール', 'Call')}</span>}
      </span>
    </span>
  );
}

// ------------------------------------------------------------------ 銘柄から見る

const KIND: Record<Ownership['insiders'][number]['kind'], { label: { ja: string; en: string }; tone: 'up' | 'down' | 'neutral' | 'warn' }> = {
  buy: { label: { ja: '買い', en: 'Buy' }, tone: 'up' },
  sell: { label: { ja: '売り', en: 'Sell' }, tone: 'down' },
  gift: { label: { ja: '贈与', en: 'Gift' }, tone: 'neutral' },
  grant: { label: { ja: '報酬で付与', en: 'Award' }, tone: 'neutral' },
  exercise: { label: { ja: 'オプション行使', en: 'Exercise' }, tone: 'neutral' },
  other: { label: { ja: 'その他', en: 'Other' }, tone: 'neutral' },
};

function StockTab({ symbol, funds, allFunds, onShowFund }: { symbol: string; funds: FundSummary[] | null; allFunds: Record<string, FundHoldings | string>; onShowFund: (cik: string) => void }) {
  const { t, lang } = useT();
  const [own, setOwn] = useState<{ symbol: string; data: Ownership | null; error: string | null } | null>(null);
  const [cong, setCong] = useState<{ symbol: string; trades: CongressTrade[]; error: string | null } | null>(null);
  useEffect(() => {
    let alive = true;
    api.ownership(symbol).then(
      (d) => alive && setOwn({ symbol, data: d, error: null }),
      (e) => alive && setOwn({ symbol, data: null, error: String(e instanceof Error ? e.message : e) }),
    );
    api.congress(symbol).then(
      (r) => alive && setCong({ symbol, trades: r.trades, error: null }),
      (e) => alive && setCong({ symbol, trades: [], error: String(e instanceof Error ? e.message : e) }),
    );
    return () => {
      alive = false;
    };
  }, [symbol]);

  const o = own?.symbol === symbol ? own : null;
  const c = cong?.symbol === symbol ? cong : null;

  // 有名投資家のうち、この銘柄を（上位 100 銘柄の中に）持っている・前の期に売り切った人
  const famous = useMemo(() => {
    const out: { f: FundHoldings; p: FundPosition }[] = [];
    for (const h of Object.values(allFunds)) {
      if (typeof h === 'string') continue;
      for (const p of [...h.positions, ...h.sold]) if (p.ticker === symbol && !p.putCall) out.push({ f: h, p });
    }
    return out.sort((a, b) => (a.p.change === 'sold' ? 1 : 0) - (b.p.change === 'sold' ? 1 : 0) || b.p.weight - a.p.weight);
  }, [allFunds, symbol]);
  const loaded = Object.keys(allFunds).length;
  const total = funds?.length ?? 0;

  const recent = o?.data?.insiders.filter((t) => t.date && Date.now() - new Date(t.date).getTime() < 183 * 86400_000) ?? [];
  const sum = (k: 'buy' | 'sell') => recent.filter((t) => t.kind === k).reduce((a, t) => a + (t.value ?? 0), 0);

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-2 @4xl:grid-cols-2">
      <Card
        title={`${t('有名投資家の保有', 'Famous investors')} · ${symbol}`}
        right={<span className="text-[10px] text-mute">{loaded < total ? `${t('読み込み中', 'Loading')} ${loaded}/${total}` : 'SEC 13F'}</span>}
      >
        {famous.length ? (
          <table className="w-full text-xs">
            <thead className="text-[10px] text-mute">
              <tr>
                <th className="px-3 py-1 text-left font-normal">{t('投資家', 'Investor')}</th>
                <th className="px-2 py-1 text-right font-normal">{t('比率', 'Weight')}</th>
                <th className="px-2 py-1 text-right font-normal">{t('金額', 'Value')}</th>
                <th className="px-3 py-1 text-right font-normal">{t('前の期から', 'vs last qtr')}</th>
              </tr>
            </thead>
            <tbody>
              {famous.map(({ f, p }) => (
                <tr key={f.cik + p.cusip} className="border-t border-line/50 hover:bg-white/[0.03]">
                  <td className="px-3 py-1">
                    <button onClick={() => onShowFund(f.cik)} className="text-left hover:underline">
                      {managerName(f, lang)}
                    </button>
                    <div className="text-[10px] text-mute">
                      {f.fund} · {quarterEnd(f.reportDate, lang)}
                    </div>
                  </td>
                  <td className="num px-2 py-1 text-right">{p.change === 'sold' ? '—' : pct(p.weight)}</td>
                  <td className="num px-2 py-1 text-right">{p.change === 'sold' ? '—' : usd(p.value)}</td>
                  <td className="px-3 py-1 text-right">
                    <ChangeBadge p={p} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="p-3 text-xs text-mute">
            {loaded < total
              ? t('有名投資家の 13F を読み込み中…', 'Loading famous investors’ 13Fs…')
              : t(`登録している ${total} 人の上位 100 銘柄には ${symbol} はありません。`, `${symbol} is not in the top 100 holdings of any of the ${total} tracked investors.`)}
          </p>
        )}
        <p className="border-t border-line/50 px-3 py-1.5 text-[10px] text-mute">
          {t('比率はその投資家の米国株の運用額に占める割合。13F は四半期末から最大 45 日遅れで公開されます。', 'Weight is the share of the investor’s US equity portfolio. 13Fs are filed up to 45 days after quarter end.')}
        </p>
      </Card>

      <Card
        title={t('役員の売買（Form 4）', 'Insider trades (Form 4)')}
        right={<span className="text-[10px] text-mute">Yahoo Finance · SEC</span>}
      >
        {o?.error && <p className="p-3 text-xs text-downc">{o.error}</p>}
        {!o && <p className="p-3 text-xs text-mute">{t('読み込み中…', 'Loading…')}</p>}
        {o?.data && (
          <>
            <div className="flex flex-wrap gap-x-4 gap-y-0.5 px-3 py-1.5 text-[11px]">
              <span>
                <span className="text-mute">{t('直近 6 か月 買い ', 'Last 6 mo buys ')}</span>
                <span className="num text-upc">{usd(sum('buy') || 0)}</span>
              </span>
              <span>
                <span className="text-mute">{t('売り ', 'Sells ')}</span>
                <span className="num text-downc">{usd(sum('sell') || 0)}</span>
              </span>
              <span>
                <span className="text-mute">{t('役員の保有 ', 'Insiders own ')}</span>
                <span className="num">{pct(o.data.insidersPct)}</span>
              </span>
            </div>
            <div className="max-h-[300px] overflow-auto">
              <table className="w-full text-xs">
                <tbody>
                  {o.data.insiders.slice(0, 20).map((t, i) => (
                    <tr key={i} className="border-t border-line/50" title={t.text}>
                      <td className="num whitespace-nowrap py-1 pl-3 pr-1 text-mute" title={t.date ?? undefined}>
                        {t.date ? (
                          <>
                            <span className="max-md:hidden">{t.date.slice(2, 4)}/</span>
                            {t.date.slice(5, 7)}/{t.date.slice(8)}
                          </>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="px-2 py-1">
                        <div className="max-w-[130px] truncate md:max-w-[180px]">{t.name}</div>
                        <div className="max-w-[130px] truncate text-[10px] text-mute md:max-w-[180px]">{t.role}</div>
                      </td>
                      <td className="px-2 py-1">
                        <Badge tone={KIND[t.kind].tone}>{KIND[t.kind].label[lang]}</Badge>
                      </td>
                      <td className="num whitespace-nowrap px-2 py-1 text-right max-md:hidden">{t.shares ? (lang === 'en' ? `${fmtBig(t.shares)} sh` : `${fmtBig(t.shares)}株`) : '—'}</td>
                      <td className="num whitespace-nowrap py-1 pl-1 pr-3 text-right">{usd(t.value)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!o.data.insiders.length && <p className="p-3 text-xs text-mute">{t('最近の届け出はありません', 'No recent filings')}</p>}
            </div>
            <p className="border-t border-line/50 px-3 py-1.5 text-[10px] text-mute">
              {t(
                '役員・取締役・10% 以上の大株主は、売買から 2 営業日以内に届け出ます。報酬で受け取った株や、税金のための売却も含まれます。',
                'Officers, directors and 10%+ holders must file within 2 business days of a trade. Includes stock awards and sales to cover taxes.',
              )}
            </p>
          </>
        )}
      </Card>

      <Card
        title={t('大口の保有機関', 'Top institutions')}
        right={
          o?.data ? (
            <span className="text-[10px] text-mute">
              {t('機関の保有', 'Institutions own')} {pct(o.data.institutionsPct)} · {o.data.institutionsCount?.toLocaleString('en-US') ?? '—'}{t(' 社', ' firms')}
            </span>
          ) : undefined
        }
      >
        {o?.data && (
          <table className="w-full text-xs">
            <thead className="text-[10px] text-mute">
              <tr>
                <th className="px-3 py-1 text-left font-normal">{t('機関', 'Institution')}</th>
                <th className="px-2 py-1 text-right font-normal">{t('保有率', '% held')}</th>
                <th className="px-2 py-1 text-right font-normal">{t('金額', 'Value')}</th>
                <th className="px-3 py-1 text-right font-normal">{t('前の期から', 'vs last qtr')}</th>
              </tr>
            </thead>
            <tbody>
              {o.data.institutions.map((h) => (
                <tr key={h.name} className="border-t border-line/50">
                  <td className="max-w-[140px] truncate px-3 py-1 md:max-w-[200px]" title={h.reportDate ? t(`${h.reportDate} 時点`, `As of ${h.reportDate}`) : undefined}>
                    {h.name}
                  </td>
                  <td className="num px-2 py-1 text-right">{pct(h.pctHeld, 2)}</td>
                  <td className="num px-2 py-1 text-right">{usd(h.value)}</td>
                  <td className={`num px-3 py-1 text-right ${h.pctChange === null || Math.abs(h.pctChange) < 0.0005 ? 'text-mute' : h.pctChange > 0 ? 'text-upc' : 'text-downc'}`}>
                    {h.pctChange === null ? '—' : `${h.pctChange > 0 ? '+' : ''}${(h.pctChange * 100).toFixed(1)}%`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {!o?.data && <p className="p-3 text-xs text-mute">{o?.error ?? t('読み込み中…', 'Loading…')}</p>}
      </Card>

      <Card title={`${t('議員の売買', 'Congress trades')} · ${symbol}`} right={<span className="text-[10px] text-mute">FMP · STOCK Act</span>}>
        <CongressList trades={c?.trades ?? []} error={c?.error ?? null} loading={!c} showSymbol={false} />
      </Card>
    </div>
  );
}

// ------------------------------------------------------------------ 有名投資家から見る

function FundsTab({
  funds,
  allFunds,
  cik,
  setCik,
  onPick,
  watch,
}: {
  funds: FundSummary[];
  allFunds: Record<string, FundHoldings | string>;
  cik: string;
  setCik: (c: string) => void;
  onPick: (s: string) => void;
  watch: Set<string>;
}) {
  const { t, lang } = useT();
  const h = allFunds[cik];
  const max = typeof h === 'object' ? Math.max(...h.positions.map((p) => p.weight)) : 1;
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-2 md:grid-cols-[220px_minmax(0,1fr)]">
      <Card title={t('有名投資家', 'Famous investors')} className="max-md:order-first">
        <ul className="max-md:flex max-md:overflow-x-auto">
          {funds.map((f) => {
            const d = allFunds[f.cik];
            return (
              <li key={f.cik} className="max-md:shrink-0">
                <button
                  onClick={() => setCik(f.cik)}
                  className={`w-full border-l-2 px-3 py-1.5 text-left max-md:border-b-2 max-md:border-l-0 ${f.cik === cik ? 'border-accent bg-accent/10' : 'border-transparent hover:bg-white/[0.04]'}`}
                >
                  <div className="text-xs">{managerName(f, lang)}</div>
                  <div className="flex justify-between gap-2 text-[10px] text-mute">
                    <span className="truncate">{f.fund}</span>
                    <span className="num shrink-0">{typeof d === 'object' ? usd(d.totalValue) : d ? '×' : '…'}</span>
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      </Card>

      <div className="min-w-0">
        {typeof h === 'string' && <Card className="p-3 text-xs text-downc">{h}</Card>}
        {!h && <Card className="p-3 text-xs text-mute">{t('13F を読み込み中…', 'Loading 13F…')}</Card>}
        {typeof h === 'object' && (
          <div className="flex flex-col gap-2">
            <Card className="flex flex-wrap items-baseline gap-x-4 gap-y-1 px-3 py-2">
              <span className="text-base font-semibold">{managerName(h, lang)}</span>
              <span className="text-xs text-mute">{h.fund}</span>
              <span className="text-[11px]">
                <span className="text-mute">{t('対象 ', 'Period ')}</span>
                {quarterEnd(h.reportDate, lang)}{t(`（${h.reportDate}）`, ` (${h.reportDate})`)}
              </span>
              <span className="text-[11px]">
                <span className="text-mute">{t('届け出 ', 'Filed ')}</span>
                {fmtDate(h.filingDate)} {h.filingDate.slice(0, 4)}
              </span>
              <span className="text-[11px]">
                <span className="text-mute">{t('運用額 ', 'AUM ')}</span>
                <span className="num">{usd(h.totalValue)}</span>
              </span>
              <span className="text-[11px]">
                <span className="text-mute">{t('銘柄数 ', 'Holdings ')}</span>
                <span className="num">{h.count}</span>
              </span>
              <a
                href={`https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${h.cik}&type=13F-HR`}
                target="_blank"
                rel="noreferrer noopener"
                className="ml-auto text-[10px] text-mute hover:text-ink"
              >
                {t('SEC の原本 ↗', 'SEC filing ↗')}
              </a>
            </Card>
            <Card
              title={t(`保有銘柄（上位 ${Math.min(30, h.positions.length)}）`, `Holdings (top ${Math.min(30, h.positions.length)})`)}
              right={<span className="text-[10px] text-mute">{h.prevReportDate ? t(`${quarterEnd(h.prevReportDate, lang)}との比較`, `vs ${quarterEnd(h.prevReportDate, lang)}`) : ''}</span>}
            >
              <div className="overflow-x-auto">
                <table className="w-full text-xs md:min-w-[460px]">
                  <thead className="text-[10px] text-mute">
                    <tr>
                      <th className="w-6 px-2 py-1 text-right font-normal max-md:hidden">#</th>
                      <th className="px-2 py-1 text-left font-normal">{t('銘柄', 'Stock')}</th>
                      <th className="px-2 py-1 text-right font-normal md:w-[22%] md:text-left">{t('比率', 'Weight')}</th>
                      <th className="px-2 py-1 text-right font-normal">{t('金額', 'Value')}</th>
                      <th className="px-3 py-1 text-right font-normal">{t('前の期から', 'vs last qtr')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {h.positions.slice(0, 30).map((p, i) => (
                      <tr key={p.cusip + (p.putCall ?? '')} className="border-t border-line/50 hover:bg-white/[0.03]">
                        <td className="num px-2 py-1 text-right text-mute max-md:hidden">{i + 1}</td>
                        <td className="max-w-[90px] px-2 py-1 md:max-w-[220px]">
                          <Ticker p={p} onPick={onPick} watch={watch} />
                        </td>
                        <td className="px-2 py-1">
                          <div className="flex items-center gap-1.5">
                            <div className="h-2 flex-1 rounded-r-sm bg-white/5 max-md:hidden">
                              <div className="h-2 rounded-r-sm" style={{ width: `${(p.weight / max) * 100}%`, background: BAR }} />
                            </div>
                            <span className="num ml-auto w-11 text-right">{pct(p.weight)}</span>
                          </div>
                        </td>
                        <td className="num px-2 py-1 text-right">{usd(p.value)}</td>
                        <td className="px-3 py-1 text-right">
                          <ChangeBadge p={p} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
            {h.sold.length > 0 && (
              <Card title={t('前の期から全部売った銘柄', 'Sold out since last qtr')} right={<span className="text-[10px] text-mute">{t('金額は前の期末', 'Value as of prior qtr end')}</span>}>
                <ul className="flex flex-wrap gap-x-4 gap-y-1 px-3 py-2 text-xs">
                  {h.sold.slice(0, 15).map((p) => (
                    <li key={p.cusip + (p.putCall ?? '')} className="flex max-w-[260px] items-baseline gap-1.5">
                      <Ticker p={p} onPick={onPick} watch={watch} />
                      <span className="num shrink-0 text-[10px] text-mute">{usd(p.value)}</span>
                    </li>
                  ))}
                </ul>
              </Card>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ 議員

function CongressList({ trades, error, loading, showSymbol, onPick }: { trades: CongressTrade[]; error: string | null; loading: boolean; showSymbol: boolean; onPick?: (s: string) => void }) {
  const { t: tt } = useT();
  if (loading) return <p className="p-3 text-xs text-mute">{tt('読み込み中…', 'Loading…')}</p>;
  if (error) return <p className="p-3 text-xs text-downc">{error}</p>;
  if (!trades.length) return <p className="p-3 text-xs text-mute">{tt('報告はありません', 'No reports')}</p>;
  return (
    <div className="max-h-[420px] overflow-auto">
      <table className="w-full text-xs">
        <tbody>
          {trades.map((t, i) => {
            const buy = /purchase/i.test(t.type);
            const sell = /sale/i.test(t.type);
            return (
              <tr key={i} className="border-t border-line/50">
                <td className="num whitespace-nowrap px-3 py-1 text-mute" title={tt(`報告 ${t.disclosureDate ?? '—'}`, `Reported ${t.disclosureDate ?? '—'}`)}>
                  {t.transactionDate ?? '—'}
                </td>
                <td className="px-2 py-1">
                  <div>{t.name}</div>
                  <div className="text-[10px] text-mute">
                    {t.chamber === 'senate' ? tt('上院', 'Senate') : tt('下院', 'House')}
                    {t.district ? ` · ${t.district}` : ''}
                    {t.owner && !/self/i.test(t.owner) ? ` · ${/spouse/i.test(t.owner) ? tt('配偶者', 'Spouse') : /child/i.test(t.owner) ? tt('子', 'Child') : t.owner}` : ''}
                  </div>
                </td>
                {showSymbol && (
                  <td className="px-2 py-1">
                    {t.symbol ? (
                      <button onClick={() => onPick?.(t.symbol)} className="font-semibold text-accent hover:underline">
                        {t.symbol}
                      </button>
                    ) : (
                      <span className="text-mute">{t.asset.slice(0, 24)}</span>
                    )}
                  </td>
                )}
                <td className="px-2 py-1">
                  <Badge tone={buy ? 'up' : sell ? 'down' : 'neutral'}>{buy ? tt('買い', 'Buy') : sell ? (/partial/i.test(t.type) ? tt('一部売り', 'Partial sell') : tt('売り', 'Sell')) : t.type || '—'}</Badge>
                </td>
                <td className="num whitespace-nowrap px-3 py-1 text-right text-[11px]">{t.amount || '—'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function CongressTab({ watch, onPick }: { watch: Set<string>; onPick: (s: string) => void }) {
  const [state, setState] = useState<{ trades: CongressTrade[]; error: string | null } | null>(null);
  const [onlyWatch, setOnlyWatch] = useState(false);
  const { t } = useT();
  useEffect(() => {
    let alive = true;
    api.congress().then(
      (r) => alive && setState({ trades: r.trades, error: null }),
      (e) => alive && setState({ trades: [], error: String(e instanceof Error ? e.message : e) }),
    );
    return () => {
      alive = false;
    };
  }, []);
  const trades = (state?.trades ?? []).filter((t) => !onlyWatch || watch.has(t.symbol));
  return (
    <Card
      title={t('議員の最新の売買報告', 'Latest Congress trades')}
      right={
        <label className="flex items-center gap-1 text-[11px] text-mute">
          <input type="checkbox" checked={onlyWatch} onChange={(e) => setOnlyWatch(e.target.checked)} />
          {t('ウォッチリストの銘柄だけ', 'Watchlist only')}
        </label>
      }
    >
      <CongressList trades={trades} error={state?.error ?? null} loading={!state} showSymbol onPick={onPick} />
      <p className="border-t border-line/50 px-3 py-1.5 text-[10px] text-mute">
        {t(
          '議員は売買から最大 45 日以内に報告します。金額は「$1,001 – $15,000」のような幅でしかわかりません。日付は売買した日（マウスを乗せると報告日）。',
          'Members of Congress report trades within 45 days. Amounts are only disclosed as ranges like “$1,001 – $15,000”. Dates are trade dates (hover for the report date).',
        )}
      </p>
    </Card>
  );
}

// ------------------------------------------------------------------ 本体

export function FlowsView({ symbol, watchlist, onPick }: { symbol: string | null; watchlist: string[]; onPick: (s: string) => void }) {
  const [tab, setTab] = useState<Tab>('stock');
  const { t } = useT();
  const [funds, setFunds] = useState<FundSummary[] | null>(null);
  const [enabled, setEnabled] = useState(true);
  const [cik, setCik] = useState<string>('');
  useEffect(() => {
    api.funds().then(
      (r) => {
        setFunds(r.funds);
        setEnabled(r.enabled);
        setCik((c) => c || r.funds[0]?.cik || '');
      },
      () => setFunds([]),
    );
  }, []);
  const allFunds = useAllFunds(enabled ? funds : null, tab !== 'congress');
  const watch = useMemo(() => new Set(watchlist), [watchlist]);

  const tabs: [Tab, string][] = [
    ['stock', symbol ? t(`${symbol} の大口`, `${symbol} holders`) : t('銘柄から見る', 'By stock')],
    ['funds', t('有名投資家の保有', 'Famous investors')],
    ['congress', t('議員の売買', 'Congress trades')],
  ];
  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="flex overflow-hidden rounded-md border border-line text-xs" role="tablist">
          {tabs.map(([k, label]) => (
            <button
              key={k}
              role="tab"
              aria-selected={tab === k}
              onClick={() => setTab(k)}
              className={`whitespace-nowrap border-l border-line px-2.5 py-1 first:border-l-0 ${tab === k ? 'bg-accent/15 text-accent' : 'hover:bg-white/5'}`}
            >
              {label}
            </button>
          ))}
        </span>
        <span className="text-[10px] text-mute">{t('どれも法律で決められた届け出で、実際の売買より遅れて公開されます。', 'All are regulatory filings, published with a lag after the actual trades.')}</span>
      </div>
      {!enabled && tab !== 'congress' && (
        <Card className="px-3 py-2 text-xs text-warnc">
          {t(
            '有名投資家の 13F を読むには、SEC_USER_AGENT（名前とメールアドレス）の設定が必要です。役員の売買と保有機関は表示できます。',
            'Set SEC_USER_AGENT (name and email) to load famous investors’ 13Fs. Insider trades and institutions still work.',
          )}
        </Card>
      )}
      <div className="@container min-h-0 flex-1 overflow-auto">
        {tab === 'stock' &&
          (symbol ? (
            <StockTab
              symbol={symbol}
              funds={enabled ? funds : []}
              allFunds={allFunds}
              onShowFund={(c) => {
                setCik(c);
                setTab('funds');
              }}
            />
          ) : (
            <Card className="p-6 text-center text-sm text-mute">{t('銘柄を選んでください', 'Select a stock')}</Card>
          ))}
        {tab === 'funds' && funds && enabled && <FundsTab funds={funds} allFunds={allFunds} cik={cik} setCik={setCik} onPick={onPick} watch={watch} />}
        {tab === 'congress' && <CongressTab watch={watch} onPick={onPick} />}
      </div>
    </div>
  );
}
