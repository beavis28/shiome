import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DetailPanel } from './components/DetailPanel';
import { EconCalendar } from './components/EconCalendar';
import { ImportDialog } from './components/ImportDialog';
import { ChatPanel } from './components/ChatPanel';
import { NewsPanel } from './components/NewsPanel';
import { buildDashboardContext } from './lib/context';
import { WatchlistTable } from './components/WatchlistTable';
import { api } from './lib/api';
import { derive, type Derived, type StockState } from './lib/derive';
import { loadWatchlist, saveWatchlist } from './lib/watchlist';
import type { AppConfig, EconPayload } from './types';

const MARKET_LABEL: Record<string, string> = {
  REGULAR: '米国市場 取引中',
  PRE: 'プレマーケット',
  POST: 'アフターマーケット',
  POSTPOST: '閉場',
  PREPRE: '閉場',
  CLOSED: '閉場',
};

const SYMBOL_RE = /^[A-Z]{1,5}([.-][A-Z]{1,2})?$/;

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

  // ニュースは 5 分ごとに再取得
  useEffect(() => {
    const id = setInterval(() => !document.hidden && setNewsKey((k) => k + 1), 5 * 60_000);
    return () => clearInterval(id);
  }, []);

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
    <div className="flex h-full min-h-[720px] flex-col">
      <header className="flex items-center gap-3 border-b border-line bg-panel/60 px-4 py-2">
        <h1 className="text-sm font-bold tracking-wide">
          <span className="flex items-baseline gap-1.5">
            <img src="/favicon.svg" alt="" className="h-5 w-5 self-center" />
            Shiome
          </span>
        </h1>
        <button onClick={() => setImportOpen(true)} className="rounded-md bg-accent px-3 py-1 text-xs font-semibold text-bg hover:brightness-110">
          📷 写真から取り込み
        </button>
        <button
          onClick={() => {
            load(symbols);
            loadEcon();
            setNewsKey((k) => k + 1);
          }}
          className="rounded-md border border-line px-3 py-1 text-xs hover:bg-white/5"
        >
          ↻ 更新
        </button>
        {anyDemo && (
          <span className="rounded bg-warnc/15 px-2 py-0.5 text-[11px] text-warnc">
            デモデータ表示中（DEMO=1・実在の株価ではありません）
          </span>
        )}
        {!anyDemo && (
          <span className="flex items-center gap-2 text-[11px] text-mute">
            <span className={`flex items-center gap-1 ${marketState === 'REGULAR' ? 'text-upc' : marketActive ? 'text-warnc' : ''}`}>
              <i className={`inline-block h-1.5 w-1.5 rounded-full ${marketState === 'REGULAR' ? 'animate-pulse bg-upc' : marketActive ? 'bg-warnc' : 'bg-mute'}`} />
              {MARKET_LABEL[marketState ?? ''] ?? '—'}
            </span>
            {liveAt && (
              <span className="num">
                最終更新 {new Date(liveAt).toLocaleTimeString('ja-JP')} · 自動更新 {marketActive ? '20秒' : '5分'}
              </span>
            )}
          </span>
        )}
        <button
          onClick={() => setChatOpen((o) => !o)}
          className={`rounded-md border px-3 py-1 text-xs ${chatOpen ? 'border-accent bg-accent/15 text-accent' : 'border-line hover:bg-white/5'}`}
        >
          💬 相談
        </button>
        <div className="ml-auto flex items-center gap-1.5">
          <StatusChip on={config ? !config.demo : undefined} label="Yahoo" offText="デモモード" />
          <StatusChip on={config?.fmp} label="FMP" offText="未設定（Yahoo で代替）" />
          <StatusChip on={config?.fred} label="FRED" offText="未設定" />
          <StatusChip on={config?.anthropic} label="Claude" offText="未設定（OCR使用）" />
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

      {configError && (
        <div className="border-b border-downc/40 bg-downc/10 px-4 py-2 text-xs text-downc">
          サーバーに接続できません: {configError}
        </div>
      )}
      <main className="grid min-h-0 flex-1 grid-cols-[minmax(375px,26%)_minmax(0,1fr)_minmax(260px,21%)] gap-2 p-2">
        <WatchlistTable
          symbols={symbols}
          states={states}
          derived={derived}
          selected={selected}
          onSelect={setSelected}
          onRemove={remove}
          onAdd={(s) => add([s])}
        />
        <div className="min-h-0 min-w-0">
          {selected ? (
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

      <footer className="border-t border-line px-4 py-1 text-[10px] text-mute">
        ⚠ 本アプリは情報提供のみを目的としたもので、投資助言や売買の推奨ではありません。データは遅延・誤りを含む場合があります。投資判断はご自身の責任で行ってください。
        データ: Yahoo Finance（非公式・個人利用）/ Financial Modeling Prep / FRED / FRB（FOMC 日程）
      </footer>

      <ChatPanel
        open={chatOpen}
        onClose={() => setChatOpen(false)}
        config={config}
        selected={selected}
        getContext={async () => {
          const news = selected ? await api.news(selected).then((r) => r.news, () => []) : [];
          return buildDashboardContext({ selected, symbols, states, derived, econ, news, marketState });
        }}
      />

      {importOpen && <ImportDialog config={config} existing={symbols} onClose={() => setImportOpen(false)} onAdd={add} />}
    </div>
  );
}
