import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DetailPanel } from './components/DetailPanel';
import { EconCalendar } from './components/EconCalendar';
import { ImportDialog } from './components/ImportDialog';
import { ChatPanel } from './components/ChatPanel';
import { CompareView, DEFAULT_METRICS } from './components/CompareView';
import { HeatmapView } from './components/HeatmapView';
import { MacroView, MarketStrip } from './components/MacroView';
import { TvPlayer } from './components/TvPlayer';
import { NewsPanel } from './components/NewsPanel';
import { FlowsView } from './components/FlowsView';
import { buildDashboardContext } from './lib/context';
import { WatchlistTable } from './components/WatchlistTable';
import { api } from './lib/api';
import { derive, type Derived, type StockState } from './lib/derive';
import { DEFAULT_WATCHLIST, loadWatchlist, saveWatchlist } from './lib/watchlist';
import type { AppConfig, EconPayload, MacroPayload, Prefs, Valuation } from './types';

type MobileTab = 'list' | 'detail' | 'compare' | 'heatmap' | 'flows' | 'macro' | 'news';
const MOBILE_TABS: [MobileTab, string, string][] = [
  ['list', '📋', '銘柄'],
  ['detail', '📈', '詳細'],
  ['compare', '📊', '比較'],
  ['heatmap', '🟩', 'ヒート'],
  ['flows', '🐋', '大口'],
  ['macro', '🌐', '市場'],
  ['news', '📰', 'ニュース'],
];

const MARKET_LABEL: Record<string, string> = {
  REGULAR: '米国市場 取引中',
  PRE: 'プレマーケット',
  POST: 'アフターマーケット',
  POSTPOST: '閉場',
  PREPRE: '閉場',
  CLOSED: '閉場',
};

function readLS<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
function writeLS(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* 無視 */
  }
}

const SYMBOL_RE = /^[A-Z]{1,5}([.-][A-Z]{1,2})?$/;

function SyncChip({ state }: { state: 'off' | 'loading' | 'synced' | 'saving' | 'error' }) {
  if (state === 'off') return null;
  const label = { loading: '同期を確認中', synced: '同期済み', saving: '保存中…', error: '同期できません' }[state];
  return (
    <span
      title="ウォッチリストと比較の設定を、ログインしているメールアドレスごとに保存し、ほかの端末と同期します"
      className={`rounded px-1.5 py-0.5 text-[10px] ring-1 ring-inset ${state === 'error' ? 'text-downc ring-downc/30' : state === 'synced' ? 'text-sky-300 ring-sky-300/30' : 'text-mute ring-white/10'}`}
    >
      ☁ {label}
    </span>
  );
}

function StatusChip({ on, label, offText }: { on: boolean | undefined; label: string; offText: string }) {
  return (
    <span
      title={on ? `${label}: 設定済み` : `${label}: ${offText}`}
      className={`rounded px-1.5 py-0.5 text-[10px] ring-1 ring-inset ${on ? 'text-upc ring-upc/30' : 'text-mute ring-white/10'}`}
    >
      {label} {on ? '●' : '○'}
    </span>
  );
}

export default function App() {
  const [symbols, setSymbols] = useState<string[]>(loadWatchlist);
  const [selected, setSelected] = useState<string | null>(() => loadWatchlist()[0] ?? null);
  const [states, setStates] = useState<Record<string, StockState>>({});
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [econ, setEcon] = useState<EconPayload | null>(null);
  const [econError, setEconError] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [configError, setConfigError] = useState<string | null>(null);
  const [me, setMe] = useState<string | null>(null);
  const [chatOpen, setChatOpen] = useState(false);
  const [tvOpen, setTvOpen] = useState(() => readLS('shiome.tv.open', false));
  useEffect(() => writeLS('shiome.tv.open', tvOpen), [tvOpen]);

  // 銘柄比較（PER・PSR・時価総額など）
  const [view, setView] = useState<'detail' | 'compare' | 'heatmap' | 'flows' | 'macro'>('detail');
  const [macro, setMacro] = useState<MacroPayload | null>(null);
  const [macroError, setMacroError] = useState<string | null>(null);
  // スマホ（幅 767px 以下）は 1 画面ずつ表示し、下のタブで切り替える
  const [isMobile, setIsMobile] = useState(() => window.matchMedia('(max-width: 767px)').matches);
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 767px)');
    const f = () => setIsMobile(mq.matches);
    mq.addEventListener('change', f);
    return () => mq.removeEventListener('change', f);
  }, []);
  const [mTab, setMTab] = useState<MobileTab>('list');
  const compareMode = isMobile ? mTab === 'compare' : view === 'compare';
  const [compareSel, setCompareSel] = useState<string[]>(() => readLS('shiome.compare.symbols', [] as string[]));
  const [compareMetrics, setCompareMetrics] = useState<(keyof Valuation)[]>(() => readLS('shiome.compare.metrics', DEFAULT_METRICS));
  const [valuation, setValuation] = useState<{ data: Record<string, Valuation>; errors: Record<string, string> }>({ data: {}, errors: {} });
  const [valuationLoading, setValuationLoading] = useState(false);
  useEffect(() => writeLS('shiome.compare.symbols', compareSel), [compareSel]);
  useEffect(() => writeLS('shiome.compare.metrics', compareMetrics), [compareMetrics]);
  const inflight = useRef(new Set<string>());
  const [liveAt, setLiveAt] = useState<string | null>(null);
  const [newsKey, setNewsKey] = useState(0);
  const symbolsRef = useRef(symbols);
  symbolsRef.current = symbols;

  useEffect(() => {
    saveWatchlist(symbols);
  }, [symbols]);

  const load = useCallback(async (list: string[]) => {
    const queue = list.filter((s) => !inflight.current.has(s));
    queue.forEach((s) => inflight.current.add(s));
    setStates((st) => ({ ...st, ...Object.fromEntries(queue.map((s) => [s, { ...st[s], loading: true, error: undefined }])) }));
    // 同時 3 件まで
    const worker = async () => {
      for (let s = queue.shift(); s; s = queue.shift()) {
        const sym = s;
        try {
          const data = await api.stock(sym);
          setStates((st) => ({ ...st, [sym]: { loading: false, data } }));
          setLiveAt((t) => (!t || data.fetchedAt > t ? data.fetchedAt : t));
        } catch (e) {
          setStates((st) => ({ ...st, [sym]: { loading: false, error: e instanceof Error ? e.message : String(e) } }));
        } finally {
          inflight.current.delete(sym);
        }
      }
    };
    await Promise.all([worker(), worker(), worker()]);
  }, []);

  const loadEcon = useCallback(() => {
    api.econ().then(
      (e) => {
        setEcon(e);
        setEconError(null);
      },
      (e) => setEconError(e instanceof Error ? e.message : String(e)),
    );
  }, []);

  useEffect(() => {
    api.me().then((r) => setMe(r.email), () => setMe(null));
    api.config().then(setConfig, (e) => {
      setConfig(null);
      setConfigError(e instanceof Error ? e.message : String(e));
    });
    loadEcon();
  }, [loadEcon]);

  // 未取得の銘柄だけ読み込む
  useEffect(() => {
    const missing = symbols.filter((s) => !states[s]);
    if (missing.length) load(missing);
  }, [symbols, states, load]);

  // 米国市場の状態（いずれかの銘柄の marketState から判定）
  const marketState = useMemo(() => {
    const states_ = symbols.map((s) => states[s]?.data?.quote.data?.marketState).filter(Boolean) as string[];
    return states_.find((m) => m === 'REGULAR') ?? states_.find((m) => m === 'PRE' || m === 'POST') ?? states_[0] ?? null;
  }, [symbols, states]);
  const marketActive = marketState === 'REGULAR' || marketState === 'PRE' || marketState === 'POST';
  const pollMs = marketActive ? 20_000 : 5 * 60_000;

  // 現在値の自動更新（取引時間中は 20 秒、それ以外は 5 分。タブが非表示の間は止める）
  useEffect(() => {
    if (!config || config.demo) return;
    const tick = async () => {
      if (document.hidden || !symbolsRef.current.length) return;
      try {
        const r = await api.quotes(symbolsRef.current);
        setStates((st) => {
          const next = { ...st };
          for (const [s, q] of Object.entries(r.quotes)) {
            const cur = next[s];
            if (cur?.data) next[s] = { ...cur, data: { ...cur.data, quote: { data: q, error: null, source: q.feed === 'FMP' ? 'FMP' : 'Yahoo' } } };
          }
          return next;
        });
        setLiveAt(r.at);
      } catch {
        /* 次の周期で再試行 */
      }
    };
    const id = setInterval(tick, pollMs);
    const onVis = () => !document.hidden && tick();
    document.addEventListener('visibilitychange', onVis);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [pollMs, config]);

  // 金利・商品・為替（取引時間中は 1 分、それ以外は 5 分ごと）
  useEffect(() => {
    let alive = true;
    const load = () => {
      if (document.hidden) return;
      api.macro().then(
        (m) => {
          if (!alive) return;
          setMacro(m);
          setMacroError(null);
        },
        (e) => alive && setMacroError(e instanceof Error ? e.message : String(e)),
      );
    };
    load();
    const id = setInterval(load, marketActive ? 60_000 : 5 * 60_000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [marketActive]);

  // ニュースは 5 分ごとに再取得
  useEffect(() => {
    const id = setInterval(() => !document.hidden && setNewsKey((k) => k + 1), 5 * 60_000);
    return () => clearInterval(id);
  }, []);

  const compareSymbols = useMemo(() => {
    const sel = compareSel.filter((s) => symbols.includes(s));
    return sel.length ? sel : symbols.slice(0, 12);
  }, [compareSel, symbols]);

  useEffect(() => {
    if (!compareMode) return;
    const missing = compareSymbols.filter((s) => !valuation.data[s] && !valuation.errors[s]);
    if (!missing.length) return;
    let alive = true;
    setValuationLoading(true);
    api
      .valuation(missing)
      .then((r) => alive && setValuation((v) => ({ data: { ...v.data, ...r.data }, errors: { ...v.errors, ...r.errors } })))
      .catch((e) => alive && setValuation((v) => ({ ...v, errors: { ...v.errors, ...Object.fromEntries(missing.map((s) => [s, String(e)])) } })))
      .finally(() => alive && setValuationLoading(false));
    return () => {
      alive = false;
    };
  }, [compareMode, compareSymbols, valuation]);

  // ── 端末をまたいだ同期（ログインしているときだけ。新しいほうを採用） ──
  const [sync, setSync] = useState<'off' | 'loading' | 'synced' | 'saving' | 'error'>('loading');
  const syncReady = useRef(false);
  // 最後にサーバーと一致させた内容（同じなら保存しない）
  const lastSynced = useRef('');
  const contentKey = (p: Pick<Prefs, 'watchlist' | 'compareSymbols' | 'compareMetrics'>) => JSON.stringify([p.watchlist, p.compareSymbols, p.compareMetrics]);
  const localUpdatedAt = useRef<number>(readLS('shiome.prefs.updatedAt', 0));
  const setLocalUpdated = (t: number) => {
    localUpdatedAt.current = t;
    writeLS('shiome.prefs.updatedAt', t);
  };
  const applyRemote = useCallback((p: Prefs) => {
    lastSynced.current = contentKey(p);
    setSymbols(p.watchlist);
    setCompareSel(p.compareSymbols);
    if (p.compareMetrics.length) setCompareMetrics(p.compareMetrics as (keyof Valuation)[]);
    setSelected((cur) => (cur && p.watchlist.includes(cur) ? cur : (p.watchlist[0] ?? null)));
    setLocalUpdated(p.updatedAt);
  }, []);
  const prefsNow = useRef<Prefs | null>(null);
  prefsNow.current = { watchlist: symbols, compareSymbols: compareSel, compareMetrics: compareMetrics as string[], updatedAt: localUpdatedAt.current };

  const pull = useCallback(async () => {
    try {
      const r = await api.prefs();
      if (!r.sync) {
        setSync('off');
        return;
      }
      if (r.prefs && !localUpdatedAt.current) {
        // この端末で初めての同期：サーバーの内容に、この端末だけにある銘柄を足す（どちらも消さない）
        const local = prefsNow.current!.watchlist;
        const isDefault = local.length === DEFAULT_WATCHLIST.length && local.every((x, i) => x === DEFAULT_WATCHLIST[i]);
        const extra = isDefault ? [] : local.filter((x) => !r.prefs!.watchlist.includes(x));
        if (extra.length) {
          const merged: Prefs = { ...r.prefs, watchlist: [...r.prefs.watchlist, ...extra].slice(0, 100), updatedAt: Date.now() };
          applyRemote(merged);
          await api.savePrefs(merged);
        } else applyRemote(r.prefs);
      } else if (r.prefs && r.prefs.updatedAt > localUpdatedAt.current) applyRemote(r.prefs);
      else if (!r.prefs || r.prefs.updatedAt < localUpdatedAt.current || !localUpdatedAt.current) {
        // サーバーにまだない／手元のほうが新しい → 送る
        const t = localUpdatedAt.current || Date.now();
        setLocalUpdated(t);
        await api.savePrefs({ ...prefsNow.current!, updatedAt: t });
        lastSynced.current = contentKey(prefsNow.current!);
      } else lastSynced.current = contentKey(r.prefs);
      setSync('synced');
    } catch {
      setSync('error');
    } finally {
      syncReady.current = true;
    }
  }, [applyRemote]);

  useEffect(() => {
    pull();
    const onVis = () => !document.hidden && syncReady.current && pull();
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('focus', onVis);
    return () => {
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('focus', onVis);
    };
  }, [pull]);

  // 変更したら少し待ってから保存（KV の書き込み回数を節約）
  useEffect(() => {
    if (!syncReady.current || sync === 'off' || contentKey(prefsNow.current!) === lastSynced.current) return;
    const t = Date.now();
    setLocalUpdated(t);
    setSync('saving');
    const id = setTimeout(() => {
      api.savePrefs({ ...prefsNow.current!, updatedAt: t }).then(
        (r) => {
          if (r.prefs.updatedAt > t) applyRemote(r.prefs);
          else lastSynced.current = contentKey(r.prefs);
          setSync('synced');
        },
        () => setSync('error'),
      );
    }, 1500);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbols, compareSel, compareMetrics]);

  const derived = useMemo(() => {
    const out: Record<string, Derived> = {};
    for (const s of symbols) out[s] = derive(states[s]?.data);
    return out;
  }, [symbols, states]);

  const add = useCallback((list: string[]) => {
    const clean = list.map((s) => s.trim().toUpperCase()).filter((s) => SYMBOL_RE.test(s));
    if (!clean.length) return;
    setSymbols((cur) => [...cur, ...clean.filter((s) => !cur.includes(s))]);
    setSelected(clean[0]);
  }, []);

  const remove = (s: string) => {
    setSymbols((cur) => cur.filter((x) => x !== s));
    if (selected === s) setSelected(symbols.find((x) => x !== s) ?? null);
  };

  const earnings = useMemo(
    () => symbols.flatMap((s) => (states[s]?.data?.earnings.data?.date ? [{ symbol: s, date: states[s]!.data!.earnings.data!.date! }] : [])),
    [symbols, states],
  );
  const anyDemo = symbols.some((s) => states[s]?.data?.demo);

  return (
    <div className="flex h-[100dvh] flex-col md:h-full md:min-h-[720px]">
      <header className="flex items-center gap-2 border-b border-line bg-panel/60 px-2 py-2 md:gap-3 md:px-4">
        <h1 className="text-sm font-bold tracking-wide">
          <span className="flex items-baseline gap-1.5">
            <img src="/favicon.svg" alt="" className="h-5 w-5 self-center" />
            Shiome
          </span>
        </h1>
        <button onClick={() => setImportOpen(true)} className="shrink-0 whitespace-nowrap rounded-md bg-accent px-3 py-1 text-xs font-semibold text-bg hover:brightness-110">
          📷<span className="max-md:hidden"> 写真から取り込み</span>
        </button>
        <button
          onClick={() => {
            load(symbols);
            loadEcon();
            setNewsKey((k) => k + 1);
          }}
          className="shrink-0 whitespace-nowrap rounded-md border border-line px-3 py-1 text-xs hover:bg-white/5"
        >
          ↻<span className="max-md:hidden"> 更新</span>
        </button>
        <button
          onClick={() => setChatOpen((o) => !o)}
          aria-pressed={chatOpen}
          title="表示中のデータやウェブ検索をもとに、AI に相場について質問できます"
          className={`relative flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md px-3.5 py-1 text-xs font-semibold shadow-[0_0_0_1px_rgba(255,255,255,.08)] transition ${
            chatOpen
              ? 'bg-white text-bg'
              : 'bg-gradient-to-r from-violet-500 to-fuchsia-500 text-white hover:brightness-110'
          }`}
        >
          {!chatOpen && <span className="absolute -right-1 -top-1 h-2 w-2 animate-ping rounded-full bg-fuchsia-300 [animation-iteration-count:3]" />}
          💬 AI<span className="max-md:hidden"> に相談</span>
        </button>
        <button
          onClick={() => setTvOpen((o) => !o)}
          title="経済ニュースのライブ配信（Bloomberg など）"
          className={`shrink-0 whitespace-nowrap rounded-md border px-3 py-1 text-xs ${tvOpen ? 'border-accent bg-accent/15 text-accent' : 'border-line hover:bg-white/5'}`}
        >
          📺 TV
        </button>
        {anyDemo && (
          <span className="rounded bg-warnc/15 px-2 py-0.5 text-[11px] text-warnc">
            デモデータ表示中（DEMO=1・実在の株価ではありません）
          </span>
        )}
        {!anyDemo && (
          <span className="flex min-w-0 items-center gap-2 overflow-hidden whitespace-nowrap text-[11px] text-mute">
            <span className={`flex items-center gap-1 ${marketState === 'REGULAR' ? 'text-upc' : marketActive ? 'text-warnc' : ''}`}>
              <i className={`inline-block h-1.5 w-1.5 rounded-full ${marketState === 'REGULAR' ? 'animate-pulse bg-upc' : marketActive ? 'bg-warnc' : 'bg-mute'}`} />
              <span className="max-md:hidden">{MARKET_LABEL[marketState ?? ''] ?? '—'}</span>
            </span>
            {liveAt && (
              <span className="num truncate max-md:hidden">
                最終更新 {new Date(liveAt).toLocaleTimeString('ja-JP')} · 自動更新 {marketActive ? '20秒' : '5分'}
              </span>
            )}
          </span>
        )}
        <span className="flex shrink-0 overflow-hidden rounded-md border border-line text-xs max-md:hidden" role="tablist" aria-label="表示の切り替え">
          {(
            [
              ['detail', '📈 詳細'],
              ['compare', '📊 比較'],
              ['heatmap', '🟩 ヒートマップ'],
              ['flows', '🐋 大口の売買'],
              ['macro', '🌐 金利・商品・為替'],
            ] as const
          ).map(([k, label]) => (
            <button
              key={k}
              role="tab"
              aria-selected={view === k}
              onClick={() => setView(k)}
              className={`whitespace-nowrap border-l border-line px-2.5 py-1 first:border-l-0 ${view === k ? 'bg-accent/15 text-accent' : 'hover:bg-white/5'}`}
            >
              {label}
            </button>
          ))}
        </span>
        <div className="ml-auto flex items-center gap-1.5 max-md:hidden">
          <StatusChip on={config ? !config.demo : undefined} label="Yahoo" offText="デモモード" />
          <StatusChip on={config?.fmp} label="FMP" offText="未設定（Yahoo で代替）" />
          <StatusChip on={config?.fred} label="FRED" offText="未設定" />
          <StatusChip on={config?.anthropic} label="Claude" offText="未設定（OCR使用）" />
          <SyncChip state={sync} />
          {me && (
            <span className="ml-2 flex items-center gap-2 border-l border-line pl-3 text-[11px] text-mute">
              <span className="max-w-[180px] truncate" title={me}>
                {me}
              </span>
              <a href="/cdn-cgi/access/logout" className="rounded border border-line px-2 py-0.5 hover:bg-white/5 hover:text-ink">
                ログアウト
              </a>
            </span>
          )}
        </div>
      </header>

      <MarketStrip macro={macro} onOpen={() => (isMobile ? setMTab('macro') : setView('macro'))} />

      {configError && (
        <div className="border-b border-downc/40 bg-downc/10 px-4 py-2 text-xs text-downc">
          サーバーに接続できません: {configError}
        </div>
      )}
      {isMobile ? (
        <>
          <main className="min-h-0 flex-1 overflow-y-auto p-2 pb-20">
            {mTab === 'list' && (
              <div className="flex flex-col gap-3">
                <WatchlistTable
                  symbols={symbols}
                  states={states}
                  derived={derived}
                  selected={selected}
                  onSelect={(s) => {
                    setSelected(s);
                    setMTab('detail');
                  }}
                  onRemove={remove}
                  onAdd={(s) => add([s])}
                />
                <div className="flex flex-wrap items-center gap-1.5 px-1">
                  <StatusChip on={config ? !config.demo : undefined} label="Yahoo" offText="デモモード" />
                  <StatusChip on={config?.fmp} label="FMP" offText="未設定（Yahoo で代替）" />
                  <StatusChip on={config?.fred} label="FRED" offText="未設定" />
                  <StatusChip on={config?.anthropic} label="Claude" offText="未設定（OCR使用）" />
          <SyncChip state={sync} />
                  {me && (
                    <span className="ml-auto flex items-center gap-2 text-[11px] text-mute">
                      <span className="max-w-[160px] truncate">{me}</span>
                      <a href="/cdn-cgi/access/logout" className="rounded border border-line px-2 py-0.5">
                        ログアウト
                      </a>
                    </span>
                  )}
                </div>
                <p className="px-1 text-[10px] leading-relaxed text-mute">
                  ⚠ 本アプリは情報提供のみを目的としたもので、投資助言や売買の推奨ではありません。データは遅延・誤りを含む場合があります。投資判断はご自身の責任で行ってください。
                </p>
              </div>
            )}
            {mTab === 'detail' &&
              (selected ? (
                <div className="flex flex-col gap-2">
                  <DetailPanel symbol={selected} state={states[selected]} d={derived[selected]} />
                  <div className="h-[420px]">
                    <NewsPanel symbol={selected} refreshKey={newsKey} />
                  </div>
                </div>
              ) : (
                <p className="p-6 text-center text-sm text-mute">「銘柄」タブで銘柄を選んでください</p>
              ))}
            {mTab === 'compare' && (
              <div className="flex flex-col gap-2">
                <div className="flex flex-wrap gap-1.5 rounded-lg border border-line bg-panel p-2">
                  <span className="w-full text-[11px] text-mute">比べる銘柄（タップで切り替え）</span>
                  {symbols.map((sym) => {
                    const on = compareSymbols.includes(sym);
                    return (
                      <button
                        key={sym}
                        onClick={() =>
                          setCompareSel((cur) => {
                            const base = cur.filter((x) => symbols.includes(x)).length ? cur : compareSymbols;
                            return base.includes(sym) ? base.filter((x) => x !== sym) : [...base, sym];
                          })
                        }
                        className={`rounded-full border px-2.5 py-1 text-xs ${on ? 'border-accent bg-accent/15 text-accent' : 'border-line text-mute'}`}
                      >
                        {sym}
                      </button>
                    );
                  })}
                </div>
                <CompareView
                  symbols={compareSymbols}
                  data={valuation.data}
                  errors={Object.fromEntries(Object.entries(valuation.errors).filter(([k]) => compareSymbols.includes(k)))}
                  loading={valuationLoading}
                  focus={selected}
                  onFocus={setSelected}
                  metrics={compareMetrics}
                  onMetrics={setCompareMetrics}
                />
              </div>
            )}
            {mTab === 'heatmap' && (
              <div className="h-[calc(100dvh-210px)] min-h-[460px]">
                <HeatmapView
                  watchlist={symbols}
                  refreshMs={pollMs}
                  onPick={(sym) => {
                    if (!symbols.includes(sym)) add([sym]);
                    setSelected(sym);
                    setMTab('detail');
                  }}
                />
              </div>
            )}
            {mTab === 'flows' && (
              <FlowsView
                symbol={selected}
                watchlist={symbols}
                onPick={(sym) => {
                  if (!symbols.includes(sym)) add([sym]);
                  setSelected(sym);
                  setMTab('detail');
                }}
              />
            )}
            {mTab === 'macro' && <MacroView macro={macro} error={macroError} econ={econ} />}
            {mTab === 'news' && (
              <div className="flex flex-col gap-2">
                <div className="h-[55vh]">
                  <NewsPanel symbol={selected} refreshKey={newsKey} />
                </div>
                <div className="h-[70vh]">
                  <EconCalendar econ={econ} econError={econError} earnings={earnings} onSelect={(s) => { setSelected(s); setMTab('detail'); }} />
                </div>
              </div>
            )}
          </main>
          <nav className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-7 border-t border-line bg-panel/95 pb-[env(safe-area-inset-bottom)] backdrop-blur" aria-label="画面の切り替え">
            {MOBILE_TABS.map(([k, icon, label]) => (
              <button
                key={k}
                onClick={() => setMTab(k)}
                aria-current={mTab === k ? 'page' : undefined}
                className={`flex flex-col items-center gap-0.5 py-1.5 text-[10px] ${mTab === k ? 'text-accent' : 'text-mute'}`}
              >
                <span className="text-lg leading-none">{icon}</span>
                {label}
              </button>
            ))}
          </nav>
        </>
      ) : (
    <main className="grid min-h-0 flex-1 grid-cols-[minmax(375px,26%)_minmax(0,1fr)_minmax(260px,21%)] gap-2 p-2">
          <WatchlistTable
            symbols={symbols}
            states={states}
            derived={derived}
            selected={selected}
            onSelect={setSelected}
            onRemove={remove}
            onAdd={(s) => add([s])}
            compare={
              compareMode
                ? {
                    checked: compareSymbols,
                    toggle: (s) =>
                      setCompareSel((cur) => {
                        const base = cur.filter((x) => symbols.includes(x)).length ? cur : compareSymbols;
                        return base.includes(s) ? base.filter((x) => x !== s) : [...base, s];
                      }),
                  }
                : undefined
            }
          />
          <div className="min-h-0 min-w-0">
            {view === 'macro' ? (
              <MacroView macro={macro} error={macroError} econ={econ} />
            ) : view === 'flows' ? (
              <FlowsView
                symbol={selected}
                watchlist={symbols}
                onPick={(sym) => {
                  if (!symbols.includes(sym)) add([sym]);
                  setSelected(sym);
                  setView('detail');
                }}
              />
            ) : view === 'heatmap' ? (
              <HeatmapView
                watchlist={symbols}
                refreshMs={pollMs}
                onPick={(sym) => {
                  if (!symbols.includes(sym)) add([sym]);
                  setSelected(sym);
                  setView('detail');
                }}
              />
            ) : compareMode ? (
              <CompareView
                symbols={compareSymbols}
                data={valuation.data}
                errors={Object.fromEntries(Object.entries(valuation.errors).filter(([k]) => compareSymbols.includes(k)))}
                loading={valuationLoading}
                focus={selected}
                onFocus={setSelected}
                metrics={compareMetrics}
                onMetrics={setCompareMetrics}
              />
            ) : selected ? (
              <DetailPanel symbol={selected} state={states[selected]} d={derived[selected]} />
            ) : (
              <div className="flex h-full items-center justify-center rounded-lg border border-line bg-panel text-sm text-mute">銘柄を選択してください</div>
            )}
          </div>
          <div className="grid min-h-0 min-w-0 grid-rows-[minmax(0,1fr)_minmax(0,1fr)] gap-2">
            <NewsPanel symbol={selected} refreshKey={newsKey} />
            <EconCalendar econ={econ} econError={econError} earnings={earnings} onSelect={setSelected} />
          </div>
        </main>
      )}

      <footer className="hidden border-t border-line px-4 py-1 text-[10px] text-mute md:block">
        ⚠ 本アプリは情報提供のみを目的としたもので、投資助言や売買の推奨ではありません。データは遅延・誤りを含む場合があります。投資判断はご自身の責任で行ってください。
        データ: Yahoo Finance（非公式・個人利用）/ Financial Modeling Prep / FRED / FRB（FOMC 日程）
      </footer>

      {tvOpen && <TvPlayer onClose={() => setTvOpen(false)} />}

      <ChatPanel
        open={chatOpen}
        onClose={() => setChatOpen(false)}
        config={config}
        selected={selected}
        getContext={async () => {
          const news = selected ? await api.news(selected).then((r) => r.news, () => []) : [];
          const base = buildDashboardContext({ selected, symbols, states, derived, econ, news, marketState });
          const ctx = macro
            ? {
                ...base,
                markets: {
                  note: 'rates in %, change for rates is in percentage points; others changePct in %',
                  usEconomicIndicators: macro.indicators.map((i) => ({ name: i.label, latest: i.value, previous: i.prev, period: i.date, unit: i.unit })),
                  groups: macro.groups.map((g) => ({
                    group: g.label,
                    items: g.items.map((i) => ({ name: i.label, value: i.value, change: i.change, changePct: i.changePct, threeMonthsAgo: i.spark[0]?.[1] ?? null })),
                  })),
                },
              }
            : base;
          return compareMode
            ? { ...ctx, comparison: { note: 'ratios are fractions (0.12 = 12%); source Yahoo Finance', stocks: compareSymbols.map((s) => valuation.data[s]).filter(Boolean) } }
            : ctx;
        }}
      />

      {importOpen && <ImportDialog config={config} existing={symbols} onClose={() => setImportOpen(false)} onAdd={add} />}
    </div>
  );
}
