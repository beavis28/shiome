import { useEffect, useRef, useState, type FormEvent, type PointerEvent as RPointerEvent } from 'react';
import { api } from '../lib/api';
import type { AppConfig, ChartSpec } from '../types';
import { ChatChart } from './ChatChart';

interface Source {
  title: string;
  url: string;
  date: string | null;
  providers?: string[];
}
interface Msg {
  role: 'user' | 'assistant';
  content: string;
  searches?: string[];
  sources?: Source[];
  charts?: ChartSpec[];
}

// 回答文の中で図を差し込む位置の印（表示時に図に置き換える）
const MARK = (n: number) => `\u0000CHART:${n}\u0000`;
const MARK_RE = /\u0000CHART:(\d+)\u0000/g;

const WS_KEY = 'shiome.chat.webSearch';
const readWs = () => {
  try {
    return localStorage.getItem(WS_KEY) !== '0';
  } catch {
    return true;
  }
};

/** 回答の簡易 Markdown（見出し・太字・箇条書き）を表示用に変換 */
function Rich({ text }: { text: string }) {
  const inline = (t: string) =>
    t.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
      part.startsWith('**') && part.endsWith('**') ? <strong key={i} className="font-semibold text-ink">{part.slice(2, -2)}</strong> : part,
    );
  // Markdown の表（| で始まる行が続く部分）をまとめて表にする
  const lines = text.split('\n');
  const blocks: ({ kind: 'line'; v: string } | { kind: 'table'; rows: string[][] })[] = [];
  for (const line of lines) {
    if (/^\s*\|.*\|\s*$/.test(line)) {
      const cells = line.trim().slice(1, -1).split('|').map((c) => c.trim());
      if (cells.every((c) => /^:?-{2,}:?$/.test(c))) continue; // 区切り行
      const last = blocks[blocks.length - 1];
      if (last?.kind === 'table') last.rows.push(cells);
      else blocks.push({ kind: 'table', rows: [cells] });
    } else blocks.push({ kind: 'line', v: line });
  }
  return (
    <>
      {blocks.map((b, i) => {
        if (b.kind === 'table') {
          const [head, ...body] = b.rows;
          return (
            <div key={i} className="my-2 overflow-x-auto">
              <table className="w-full text-[12px]">
                <thead>
                  <tr className="border-b border-line text-mute">
                    {head.map((c, k) => (
                      <th key={k} className="px-2 py-1 text-left font-medium">
                        {inline(c)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {body.map((r, ri) => (
                    <tr key={ri} className="border-b border-line/50">
                      {r.map((c, k) => (
                        <td key={k} className={`px-2 py-1 ${/^[−+-]?[$¥]?[\d,.]+[%倍]?$/.test(c) ? 'num text-right' : ''}`}>
                          {inline(c)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        }
        const line = b.v;
        const h = line.match(/^#{1,6}\s+(.*)/);
        if (h) return <p key={i} className="mt-2 font-semibold text-accent">{inline(h[1])}</p>;
        const li = line.match(/^\s*(?:[-*・]|\d+\.)\s+(.*)/);
        if (li) return <p key={i} className="relative pl-3.5 before:absolute before:left-0 before:text-mute before:content-['•']">{inline(li[1])}</p>;
        if (/^\s*(---|\*\*\*)\s*$/.test(line)) return <hr key={i} className="my-2 border-line" />;
        return line.trim() ? <p key={i}>{inline(line)}</p> : <div key={i} className="h-1.5" />;
      })}
    </>
  );
}

const SUGGESTIONS = [
  '表示中の銘柄の最近のニュースと決算の内容は？',
  'ウォッチリストの銘柄の6か月の値動きを図で比べて',
  'この画面の要点をまとめて',
  'テクニカル指標の状態を説明して',
  '次の決算と経済指標で注目される点は？',
  'ニュースの要点と株価との関係は？',
  'ウォッチリストの中で目立つ動きは？',
];

interface Props {
  open: boolean;
  onClose: () => void;
  config: AppConfig | null;
  selected: string | null;
  /** 送信の瞬間に、画面の最新データをまとめて返す */
  getContext: () => Promise<unknown>;
}

export function ChatPanel({ open, onClose, config, selected, getContext }: Props) {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [webSearch, setWebSearch] = useState(readWs);
  // パネルの幅（左端をドラッグで変更。保存する）
  const [width, setWidth] = useState(() => {
    try {
      return Number(localStorage.getItem('shiome.chat.width')) || 640;
    } catch {
      return 640;
    }
  });
  const startDrag = (e: RPointerEvent) => {
    e.preventDefault();
    const move = (ev: PointerEvent) => setWidth(Math.round(Math.min(Math.max(window.innerWidth - ev.clientX, 380), window.innerWidth * 0.8)));
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      setWidth((w) => {
        try {
          localStorage.setItem('shiome.chat.width', String(w));
        } catch {
          /* 無視 */
        }
        return w;
      });
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  const engines = [config?.exa && 'Exa', config?.tavily && 'Tavily'].filter(Boolean) as string[];
  const canSearch = engines.length > 0;
  const abortRef = useRef<AbortController | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [msgs]);
  useEffect(() => () => abortRef.current?.abort(), []);

  const send = async (text: string) => {
    const q = text.trim();
    if (!q || busy) return;
    const history: Msg[] = [...msgs, { role: 'user', content: q }];
    setMsgs([...history, { role: 'assistant', content: '' }]);
    setInput('');
    setBusy(true);
    const ac = new AbortController();
    abortRef.current = ac;
    try {
      const res = await api.chat(
        history.map(({ role, content, charts }) => ({ role, content: content.replace(MARK_RE, (_, n) => `[図: ${charts?.[Number(n)]?.title ?? ''}]`) })),
        await getContext(),
        canSearch && webSearch,
        ac.signal,
      );
      const reader = res.body!.getReader();
      const dec = new TextDecoder();
      let buf = '';
      const patch = (f: (m: Msg) => Msg) => setMsgs((ms) => [...ms.slice(0, -1), f(ms[ms.length - 1])]);
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.trim()) continue;
          let ev: { t: string; v?: string; q?: string; items?: Source[]; spec?: ChartSpec };
          try {
            ev = JSON.parse(line);
          } catch {
            continue;
          }
          if (ev.t === 'text') patch((m) => ({ ...m, content: m.content + (ev.v ?? '') }));
          else if (ev.t === 'search') patch((m) => ({ ...m, searches: [...(m.searches ?? []), ev.q ?? ''] }));
          else if (ev.t === 'sources') patch((m) => ({ ...m, sources: [...(m.sources ?? []), ...(ev.items ?? [])] }));
          else if (ev.t === 'chart' && ev.spec)
            patch((m) => ({ ...m, charts: [...(m.charts ?? []), ev.spec!], content: `${m.content}\n${MARK((m.charts ?? []).length)}\n` }));
          else if (ev.t === 'error') patch((m) => ({ ...m, content: `${m.content}\n\n⚠ ${ev.v}` }));
        }
      }
    } catch (e) {
      if (!ac.signal.aborted) {
        setMsgs((m) => [...m.slice(0, -1), { role: 'assistant', content: `⚠ ${e instanceof Error ? e.message : String(e)}` }]);
      }
    } finally {
      setBusy(false);
      abortRef.current = null;
    }
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    send(input);
  };

  if (!open) return null;
  return (
    <aside className="fixed bottom-0 right-0 top-0 z-40 flex max-w-[100vw] flex-col border-l border-line bg-panel shadow-2xl" style={{ width }}>
      <div
        onPointerDown={startDrag}
        title="ドラッグで幅を変更"
        className="absolute -left-1 bottom-0 top-0 z-10 w-2 cursor-col-resize hover:bg-accent/30"
      />
      <header className="flex items-center gap-2 border-b border-line px-3 py-2">
        <h2 className="text-sm font-semibold">相場の相談</h2>
        <span className="text-[11px] text-mute">{selected ? `${selected} を表示中` : ''} · Claude</span>
        <label
          className={`ml-2 flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] ${canSearch && webSearch ? 'border-accent text-accent' : 'border-line text-mute'}`}
          title={canSearch ? `必要なときにウェブを検索して答えます（${engines.join(' + ')}）` : '検索の API キー（EXA_API_KEY / TAVILY_API_KEY）が未設定のため使えません'}
        >
          <input
            type="checkbox"
            className="accent-sky-400"
            disabled={!canSearch}
            checked={canSearch && webSearch}
            onChange={(e) => {
              setWebSearch(e.target.checked);
              try {
                localStorage.setItem(WS_KEY, e.target.checked ? '1' : '0');
              } catch {
                /* 無視 */
              }
            }}
          />
          🔎 ウェブ検索
        </label>
        <div className="ml-auto flex gap-1">
          {!!msgs.length && (
            <button
              onClick={() => {
                abortRef.current?.abort();
                setMsgs([]);
              }}
              className="rounded px-2 py-0.5 text-[11px] text-mute hover:bg-white/5 hover:text-ink"
            >
              新しい相談
            </button>
          )}
          <button onClick={onClose} className="px-1 text-mute hover:text-ink" aria-label="閉じる">
            ✕
          </button>
        </div>
      </header>

      <p className="border-b border-line bg-warnc/5 px-3 py-1.5 text-[10px] leading-relaxed text-warnc">
        画面のデータ{canSearch && webSearch ? 'とウェブ検索の結果' : ''}をもとに情報を整理・解説します。売買の推奨や個別の投資助言は行いません。AI の回答は誤りを含むことがあります。
      </p>

      <div className="min-h-0 flex-1 space-y-3 overflow-auto px-3 py-3">
        {!config?.anthropic && (
          <p className="rounded bg-downc/10 p-2 text-xs text-downc">ANTHROPIC_API_KEY が未設定のため、相談機能は使えません。</p>
        )}
        {!msgs.length && config?.anthropic && (
          <div className="space-y-2">
            <p className="text-xs text-mute">表示中の銘柄・ウォッチリスト・ニュース・経済指標をもとに答えます。例えば:</p>
            <div className="flex flex-wrap gap-1.5">
              {SUGGESTIONS.map((s) => (
                <button key={s} onClick={() => send(s)} className="rounded-full border border-line px-2.5 py-1 text-[11px] hover:border-accent hover:text-accent">
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
        {msgs.map((m, i) => (
          <div key={i} className={m.role === 'user' ? 'flex justify-end' : ''}>
            <div
              className={`text-[13px] leading-relaxed ${m.role === 'user' ? 'whitespace-pre-wrap' : ''} ${
                m.role === 'user' ? 'max-w-[85%] rounded-lg bg-accent/15 px-3 py-1.5' : 'text-ink'
              }`}
            >
              {!!m.searches?.length && (
                <div className="mb-1.5 flex flex-wrap gap-1">
                  {m.searches.map((q, k) => (
                    <span key={k} className="rounded-full bg-white/5 px-2 py-0.5 text-[10px] text-mute">
                      🔎 {q}
                    </span>
                  ))}
                </div>
              )}
              {m.content.trim() ? (
                m.role === 'assistant' ? (
                  m.content.split(MARK_RE).map((part, k) =>
                    k % 2 === 1 ? (m.charts?.[Number(part)] ? <ChatChart key={k} spec={m.charts[Number(part)]} /> : null) : <Rich key={k} text={part} />,
                  )
                ) : (
                  m.content
                )
              ) : busy && i === msgs.length - 1 ? (
                <span className="animate-pulse text-mute">{m.searches?.length ? '検索結果を読んでいます…' : '考えています…'}</span>
              ) : null}
              {!!m.sources?.length && (
                <details className="mt-2 rounded border border-line/70 px-2 py-1 text-[11px]" open={m.sources.length <= 6}>
                  <summary className="cursor-pointer text-mute">出典（{m.sources.length}）</summary>
                  <ol className="mt-1 space-y-0.5">
                    {m.sources.map((src, k) => (
                      <li key={src.url} className="flex gap-1.5">
                        <span className="num text-mute">{k + 1}.</span>
                        <a href={src.url} target="_blank" rel="noreferrer noopener" className="min-w-0 flex-1 truncate text-accent hover:underline" title={src.title}>
                          {src.title || src.url}
                        </a>
                        {src.providers && src.providers.length > 1 && (
                          <span className="shrink-0 rounded bg-accent/15 px-1 text-[9px] text-accent" title="Exa と Tavily の両方で見つかった">
                            両方
                          </span>
                        )}
                        {src.providers?.length === 1 && <span className="shrink-0 text-[9px] text-mute">{src.providers[0]}</span>}
                        <span className="num shrink-0 text-mute">{src.date ? src.date.slice(0, 10) : new URL(src.url).hostname.replace(/^www\./, '')}</span>
                      </li>
                    ))}
                  </ol>
                </details>
              )}
            </div>
          </div>
        ))}
        <div ref={endRef} />
      </div>

      <form onSubmit={submit} className="flex gap-2 border-t border-line p-2">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              send(input);
            }
          }}
          rows={2}
          disabled={!config?.anthropic}
          placeholder="質問を入力（Enter で送信、Shift+Enter で改行）"
          className="min-h-0 flex-1 resize-none rounded border border-line bg-bg px-2 py-1.5 text-[13px] outline-none focus:border-accent disabled:opacity-50"
        />
        {busy ? (
          <button type="button" onClick={() => abortRef.current?.abort()} className="rounded-md border border-line px-3 text-xs hover:bg-white/5">
            停止
          </button>
        ) : (
          <button type="submit" disabled={!input.trim() || !config?.anthropic} className="rounded-md bg-accent px-3 text-xs font-semibold text-bg disabled:opacity-40">
            送信
          </button>
        )}
      </form>
    </aside>
  );
}
