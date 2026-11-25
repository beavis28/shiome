// ティッカーの追加欄。入力中に候補を出し、見つからないティッカーは「これですか？」と候補を示す
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { api } from '../lib/api';
import { useT } from '../lib/i18n';
import type { SymbolHit } from '../types';

type Unresolved = { token: string; suggestions: SymbolHit[] };
type Notice = { added: SymbolHit[]; dup: string[]; unresolved: Unresolved[]; alt?: { from: string; to: SymbolHit[] } };

/** 1 文字違い・入れ替えのティッカーか（GOGL と GOOGL など） */
const near = (a: string, b: string) => {
  if (a === b || Math.abs(a.length - b.length) > 1) return false;
  const [s, l] = a.length <= b.length ? [a, b] : [b, a];
  let i = 0;
  while (i < s.length && s[i] === l[i]) i++;
  if (s.length === l.length) return s.slice(i + 1) === l.slice(i + 1) || (s[i] === l[i + 1] && s[i + 1] === l[i] && s.slice(i + 2) === l.slice(i + 2));
  return s.slice(i) === l.slice(i + 1);
};

/** 入力を銘柄ごとに分ける。カンマ区切り、または全部ティッカーらしい語なら空白でも分ける（社名の「bank of america」は 1 つ） */
const splitTokens = (text: string) => {
  const t = text.trim();
  if (!t) return [];
  if (/[,、，]/.test(t)) return [...new Set(t.split(/[,、，]+/).map((x) => x.trim()).filter(Boolean))];
  const words = t.split(/\s+/);
  return words.length > 1 && words.every((w) => /^[A-Za-z]{1,5}([.-][A-Za-z]{1,2})?$/.test(w)) ? [...new Set(words)] : [t];
};

function Hit({ h, active, onPick, have }: { h: SymbolHit; active?: boolean; onPick: () => void; have: boolean }) {
  const { t } = useT();
  return (
    <button
      type="button"
      onMouseDown={(e) => e.preventDefault()}
      onClick={onPick}
      className={`flex w-full items-baseline gap-2 rounded px-2 py-1 text-left ${active ? 'bg-accent/15' : 'hover:bg-white/5'}`}
    >
      <span className="w-14 shrink-0 font-semibold text-accent">{h.symbol}</span>
      <span className="min-w-0 flex-1 truncate text-[11px] text-ink">{h.name || '—'}</span>
      <span className="shrink-0 text-[10px] text-mute">{have ? t('追加済み', 'Added') : [h.type === 'ETF' ? 'ETF' : '', h.exchange].filter(Boolean).join(' · ')}</span>
    </button>
  );
}

export function TickerAdd({ symbols, onAdd, onRemove }: { symbols: string[]; onAdd: (s: string) => void; onRemove: (s: string) => void }) {
  const [text, setText] = useState('');
  const [hits, setHits] = useState<{ q: string; list: SymbolHit[] } | null>(null);
  const [active, setActive] = useState(-1);
  const [focus, setFocus] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const { t } = useT();
  const have = new Set(symbols);

  // 入力中の候補（1 語だけのとき。少し待ってから調べる）
  const tokens0 = splitTokens(text);
  const q = tokens0.length === 1 ? tokens0[0] : '';
  const single = !!q;
  useEffect(() => {
    setActive(-1);
    if (!single) {
      setHits(null);
      return;
    }
    const ctl = new AbortController();
    const t = setTimeout(() => {
      api.search(q, ctl.signal).then(
        (r) => setHits({ q, list: r.suggestions }),
        () => {},
      );
    }, 250);
    return () => {
      clearTimeout(t);
      ctl.abort();
    };
  }, [q, single]);

  // 枠の外をクリックしたら案内を閉じる
  useEffect(() => {
    if (!notice) return;
    const close = (e: PointerEvent) => !box.current?.contains(e.target as Node) && setNotice(null);
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [notice]);

  const pick = (h: SymbolHit, replacing?: string) => {
    if (replacing) onRemove(replacing);
    onAdd(h.symbol);
    setText('');
    setHits(null);
    setNotice((n) => {
      if (!n) return null;
      const unresolved = n.unresolved.filter((u) => !u.suggestions.some((s) => s.symbol === h.symbol));
      const keep = unresolved.length ? { ...n, unresolved, alt: undefined, added: [...n.added.filter((a) => a.symbol !== replacing), h] } : null;
      return keep;
    });
  };

  const submit = async () => {
    const tokens = splitTokens(text);
    if (!tokens.length) return;
    setBusy(true);
    const n: Notice = { added: [], dup: [], unresolved: [] };
    try {
      for (const tok of tokens) {
        const r = await api.search(tok).catch(() => null);
        if (r?.exact) {
          if (have.has(r.exact.symbol)) n.dup.push(r.exact.symbol);
          n.added.push(r.exact);
          onAdd(r.exact.symbol);
          // 実在するが、よく似た別の銘柄もある（GOGL と GOOGL など）
          const alt = r.suggestions.filter((s) => s.symbol !== r.exact!.symbol && near(s.symbol, r.exact!.symbol));
          if (tokens.length === 1 && alt.length && !have.has(r.exact.symbol)) n.alt = { from: r.exact.symbol, to: alt.slice(0, 3) };
        } else {
          n.unresolved.push({ token: tok, suggestions: (r?.suggestions ?? []).slice(0, 5) });
        }
      }
    } finally {
      setBusy(false);
    }
    setText(n.unresolved.length && tokens.length === 1 ? text : '');
    setHits(null);
    setNotice(n.unresolved.length || n.alt || n.dup.length ? n : null);
  };

  const list = focus && single && hits?.q === q && !notice ? hits.list : [];
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' && list.length) {
      e.preventDefault();
      setActive((i) => (i + 1) % list.length);
    } else if (e.key === 'ArrowUp' && list.length) {
      e.preventDefault();
      setActive((i) => (i <= 0 ? list.length - 1 : i - 1));
    } else if (e.key === 'Escape') {
      setHits(null);
      setNotice(null);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (active >= 0 && list[active]) pick(list[active]);
      else void submit();
    }
  };

  return (
    <div ref={box} className="relative">
      <input
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setNotice(null);
        }}
        onFocus={() => setFocus(true)}
        onBlur={() => setFocus(false)}
        onKeyDown={onKey}
        placeholder={t('ティッカー・社名を追加', 'Add ticker or company')}
        aria-autocomplete="list"
        className="w-36 rounded border border-line bg-bg px-2 py-0.5 text-xs outline-none placeholder:text-mute focus:border-accent"
      />
      {busy && <span className="absolute right-2 top-1 text-[10px] text-mute">…</span>}

      {(list.length > 0 || notice) && (
        <div className="absolute right-0 top-full z-40 mt-1 w-[320px] max-w-[calc(100vw-24px)] rounded-lg border border-line bg-panel p-1 text-xs shadow-2xl">
          {list.length > 0 &&
            list.map((h, i) => <Hit key={h.symbol} h={h} active={i === active} onPick={() => pick(h)} have={have.has(h.symbol)} />)}

          {notice?.unresolved.map((u) => (
            <div key={u.token} className="mb-1">
              <p className="px-2 pb-0.5 pt-1 text-[11px]">
                {t('', 'No match for ')}
                <span className="font-semibold text-warnc">{t(`「${u.token}」`, `“${u.token}”`)}</span>
                {u.suggestions.length ? t('は見つかりませんでした。これですか？', '. Did you mean:') : t('に近い銘柄は見つかりませんでした。', ' or anything close.')}
              </p>
              {u.suggestions.map((h) => (
                <Hit key={h.symbol} h={h} onPick={() => pick(h)} have={have.has(h.symbol)} />
              ))}
            </div>
          ))}

          {notice?.alt && (
            <div className="px-2 py-1 text-[11px]">
              <p>
                <span className="font-semibold">{notice.alt.from}</span>
                <span className="text-mute">{t(`（${notice.added.find((a) => a.symbol === notice.alt!.from)?.name || '—'}）を追加しました。`, ` (${notice.added.find((a) => a.symbol === notice.alt!.from)?.name || '—'}) added.`)}</span>
              </p>
              <p className="mt-1 text-mute">{t('もしかしてこちらですか？（押すと入れ替えます）', 'Did you mean one of these? (click to swap)')}</p>
              {notice.alt.to.map((h) => (
                <Hit key={h.symbol} h={h} onPick={() => pick(h, notice.alt!.from)} have={have.has(h.symbol)} />
              ))}
            </div>
          )}

          {notice && notice.dup.length > 0 && <p className="px-2 py-1 text-[11px] text-mute">{t(`${notice.dup.join(', ')} はすでにウォッチリストにあります。`, `${notice.dup.join(', ')} already in watchlist.`)}</p>}
          {notice && notice.added.length > 0 && notice.unresolved.length > 0 && (
            <p className="border-t border-line px-2 py-1 text-[11px] text-mute">{t('追加しました: ', 'Added: ')}{notice.added.map((a) => a.symbol).join(', ')}</p>
          )}
        </div>
      )}
    </div>
  );
}
