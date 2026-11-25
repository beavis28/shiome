import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';
import { readTickersWithTesseract, resizeImage } from '../lib/ocr';
import { useT } from '../lib/i18n';
import type { AppConfig, OcrTicker } from '../types';

interface Candidate {
  id: number;
  symbol: string;
  name: string | null;
  confidence: OcrTicker['confidence'];
  checked: boolean;
  status: 'unknown' | 'ok' | 'notfound';
}

interface Props {
  config: AppConfig | null;
  existing: string[];
  onClose: () => void;
  onAdd: (symbols: string[]) => void;
}

const SYMBOL_RE = /^[A-Z]{1,5}([.-][A-Z]{1,2})?$/;
let nextId = 1;

export function ImportDialog({ config, existing, onClose, onAdd }: Props) {
  const { t } = useT();
  const [files, setFiles] = useState<{ blob: Blob; url: string }[]>([]);
  const [method, setMethod] = useState<'claude' | 'tesseract'>(config?.anthropic ? 'claude' : 'tesseract');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cands, setCands] = useState<Candidate[] | null>(null);
  const [validated, setValidated] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const addFiles = useCallback((list: FileList | File[]) => {
    const imgs = [...list].filter((f) => f.type.startsWith('image/'));
    setFiles((prev) => [...prev, ...imgs.map((blob) => ({ blob, url: URL.createObjectURL(blob) }))].slice(0, 8));
  }, []);

  // クリップボードから貼り付け（Cmd+V）
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const items = [...(e.clipboardData?.files ?? [])];
      if (items.length) addFiles(items);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('paste', onPaste);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('paste', onPaste);
      window.removeEventListener('keydown', onKey);
    };
  }, [addFiles, onClose]);

  const run = async () => {
    setError(null);
    setCands(null);
    try {
      let tickers: OcrTicker[];
      if (method === 'claude') {
        setBusy(t('Claude で読み取り中…', 'Reading with Claude…'));
        const imgs = await Promise.all(files.map((f) => resizeImage(f.blob)));
        tickers = (await api.ocr(imgs.map(({ data, mediaType }) => ({ data, mediaType })))).tickers;
      } else {
        setBusy(t('ブラウザ内 OCR で読み取り中… 0%', 'Running in-browser OCR… 0%'));
        const imgs = await Promise.all(files.map(async (f) => (await fetch((await resizeImage(f.blob, 2400)).url)).blob()));
        tickers = await readTickersWithTesseract(imgs, (p) => setBusy(t(`ブラウザ内 OCR で読み取り中… ${Math.round(p * 100)}%`, `Running in-browser OCR… ${Math.round(p * 100)}%`)));
      }
      const list: Candidate[] = tickers.map((tk) => ({
        id: nextId++,
        symbol: tk.symbol,
        name: tk.name ?? null,
        confidence: tk.confidence,
        checked: !existing.includes(tk.symbol),
        status: 'unknown',
      }));
      setCands(list);
      // 実在チェック（FMP キーがある場合のみ）
      if (list.length) {
        setBusy(t('銘柄を確認中…', 'Verifying tickers…'));
        const v = await api.validate(list.map((c) => c.symbol));
        setValidated(v.checked);
        if (v.checked) {
          setCands((cs) =>
            (cs ?? []).map((c) => {
              const hit = v.results[c.symbol];
              if (hit === undefined) return c;
              return {
                ...c,
                name: hit?.name || c.name,
                status: hit ? 'ok' : 'notfound',
                checked: c.checked && (!!hit || method === 'claude'),
              };
            }),
          );
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const update = (id: number, patch: Partial<Candidate>) => setCands((cs) => (cs ?? []).map((c) => (c.id === id ? { ...c, ...patch } : c)));
  const selected = (cands ?? []).filter((c) => c.checked && SYMBOL_RE.test(c.symbol));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onMouseDown={onClose}>
      <div className="flex max-h-[90vh] w-full max-w-3xl flex-col rounded-xl border border-line bg-panel shadow-2xl" onMouseDown={(e) => e.stopPropagation()}>
        <header className="flex items-center justify-between border-b border-line px-4 py-2.5">
          <h2 className="font-semibold">{t('写真・スクリーンショットから銘柄を取り込み', 'Import tickers from photos / screenshots')}</h2>
          <button onClick={onClose} className="text-mute hover:text-ink" aria-label={t('閉じる', 'Close')}>
            ✕
          </button>
        </header>

        <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 overflow-auto p-4 md:grid-cols-2">
          {/* 左: 画像 */}
          <div className="flex flex-col gap-3">
            <div
              onClick={() => inputRef.current?.click()}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                addFiles(e.dataTransfer.files);
              }}
              className="flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed border-line p-5 text-center text-sm text-mute hover:border-accent hover:text-ink"
            >
              <span className="text-2xl">📷</span>
              <span>{t('クリックして選択 / ドラッグ&ドロップ / ⌘V で貼り付け', 'Click to choose / drag & drop / paste with ⌘V')}</span>
              <span className="text-[11px]">{t('証券アプリやウォッチリストの画面（最大 8 枚）', 'Brokerage app or watchlist screens (up to 8)')}</span>
              <input ref={inputRef} type="file" accept="image/*" multiple hidden onChange={(e) => e.target.files && addFiles(e.target.files)} />
            </div>
            {!!files.length && (
              <div className="grid grid-cols-4 gap-2">
                {files.map((f, i) => (
                  <div key={f.url} className="group relative">
                    <img src={f.url} className="h-20 w-full rounded border border-line object-cover" />
                    <button
                      onClick={() => setFiles((fs) => fs.filter((_, j) => j !== i))}
                      className="absolute right-0.5 top-0.5 hidden rounded bg-black/70 px-1 text-xs group-hover:block"
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            )}
            <fieldset className="space-y-1 text-sm">
              <legend className="mb-1 text-xs text-mute">{t('読み取り方式', 'Method')}</legend>
              <label className={`flex items-start gap-2 ${config?.anthropic ? '' : 'opacity-50'}`}>
                <input type="radio" disabled={!config?.anthropic} checked={method === 'claude'} onChange={() => setMethod('claude')} className="mt-1" />
                <span>
                  {t('Claude（画像対応 AI）', 'Claude (vision AI)')}
                  <span className="text-[11px] text-mute"> {t('高精度・社名からも推定・API 料金あり', 'Accurate · infers from company names · API cost')}</span>
                  {!config?.anthropic && <span className="block text-[11px] text-warnc">{t('ANTHROPIC_API_KEY 未設定', 'ANTHROPIC_API_KEY not set')}</span>}
                </span>
              </label>
              <label className="flex items-start gap-2">
                <input type="radio" checked={method === 'tesseract'} onChange={() => setMethod('tesseract')} className="mt-1" />
                <span>
                  {t('ブラウザ内 OCR（Tesseract.js）', 'In-browser OCR (Tesseract.js)')}
                  <span className="text-[11px] text-mute"> {t('無料・画像は外部に送信しない', 'Free · images stay on your device')}</span>
                </span>
              </label>
            </fieldset>
            <button
              disabled={!files.length || !!busy}
              onClick={run}
              className="rounded-md bg-accent px-3 py-2 text-sm font-semibold text-bg disabled:opacity-40"
            >
              {busy ?? t('ティッカーを読み取る', 'Read tickers')}
            </button>
            {error && <p className="text-xs text-downc">{error}</p>}
          </div>

          {/* 右: 確認・修正 */}
          <div className="flex min-h-0 flex-col">
            <h3 className="mb-1 text-xs text-mute">{t('読み取り結果（追加前に確認・修正してください）', 'Results (review and edit before adding)')}</h3>
            {cands === null ? (
              <p className="rounded-lg border border-line p-4 text-xs text-mute">{t('画像を選んで「ティッカーを読み取る」を押すと、ここに候補が表示されます。', 'Choose images and press “Read tickers” to see candidates here.')}</p>
            ) : (
              <div className="min-h-0 flex-1 overflow-auto rounded-lg border border-line">
                {!cands.length && <p className="p-3 text-xs text-mute">{t('ティッカーが見つかりませんでした。下から手入力で追加できます。', 'No tickers found. You can add them manually below.')}</p>}
                {cands.map((c) => {
                  const dup = existing.includes(c.symbol);
                  const bad = !SYMBOL_RE.test(c.symbol);
                  return (
                    <div key={c.id} className="flex items-center gap-2 border-b border-line/60 px-2 py-1.5 last:border-0">
                      <input type="checkbox" checked={c.checked} onChange={(e) => update(c.id, { checked: e.target.checked })} />
                      <input
                        value={c.symbol}
                        onChange={(e) => update(c.id, { symbol: e.target.value.toUpperCase().trim(), status: 'unknown' })}
                        className={`w-20 rounded border bg-bg px-1.5 py-0.5 text-sm font-semibold uppercase outline-none focus:border-accent ${bad ? 'border-downc' : 'border-line'}`}
                      />
                      <span className="min-w-0 flex-1 truncate text-xs text-mute">{c.name ?? ''}</span>
                      {dup && <span className="text-[10px] text-mute">{t('登録済', 'Added')}</span>}
                      {c.status === 'ok' && <span className="text-[11px] text-upc" title={t('FMP で確認済み', 'Verified with FMP')}>✓</span>}
                      {c.status === 'notfound' && <span className="text-[11px] text-downc" title={t('FMP で見つかりませんでした', 'Not found on FMP')}>
                          {t('要確認', 'Check')}
                        </span>}
                      {c.status === 'unknown' && c.confidence !== 'high' && <span className="text-[10px] text-warnc">{c.confidence === 'medium' ? t('推定', 'Guess') : t('未確認', 'Unverified')}</span>}
                      <button onClick={() => setCands((cs) => (cs ?? []).filter((x) => x.id !== c.id))} className="text-mute hover:text-downc">✕</button>
                    </div>
                  );
                })}
              </div>
            )}
            {cands !== null && (
              <button
                onClick={() => setCands((cs) => [...(cs ?? []), { id: nextId++, symbol: '', name: null, confidence: 'high', checked: true, status: 'unknown' }])}
                className="mt-2 self-start text-xs text-accent hover:underline"
              >
                {t('＋ 手入力で追加', '+ Add manually')}
              </button>
            )}
            {cands !== null && !validated && <p className="mt-1 text-[11px] text-mute">{t('FMP_API_KEY 未設定のため、銘柄の実在チェックは行っていません。', 'FMP_API_KEY not set, so tickers were not verified.')}</p>}
          </div>
        </div>

        <footer className="flex items-center justify-end gap-2 border-t border-line px-4 py-2.5">
          <button onClick={onClose} className="rounded-md px-3 py-1.5 text-sm text-mute hover:text-ink">{t('キャンセル', 'Cancel')}</button>
          <button
            disabled={!selected.length}
            onClick={() => {
              onAdd([...new Set(selected.map((c) => c.symbol))]);
              onClose();
            }}
            className="rounded-md bg-upc px-3 py-1.5 text-sm font-semibold text-bg disabled:opacity-40"
          >
            {t(`ウォッチリストに追加（${selected.length}）`, `Add to watchlist (${selected.length})`)}
          </button>
        </footer>
      </div>
    </div>
  );
}
