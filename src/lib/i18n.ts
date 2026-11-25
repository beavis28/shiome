// 表示言語（日本語 / 英語）の切り替え
// 使い方: const { t, lang } = useT();  t('ウォッチリスト', 'Watchlist')
// React の外（format.ts など）では tr('…', '…') を使う。切り替えると useT / useLang を使う部品が描き直される
import { useCallback, useSyncExternalStore } from 'react';

export type Lang = 'ja' | 'en';
const KEY = 'shiome.lang';

function initial(): Lang {
  try {
    const v = localStorage.getItem(KEY);
    if (v === 'ja' || v === 'en') return v;
  } catch {
    /* 無視 */
  }
  // 初めて開いたときはブラウザの言語に合わせる
  return /^ja\b/i.test(navigator.language || '') ? 'ja' : 'en';
}

let current: Lang = typeof window === 'undefined' ? 'ja' : initial();
const listeners = new Set<() => void>();
if (typeof document !== 'undefined') document.documentElement.lang = current;

export const getLang = () => current;

export function setLang(l: Lang) {
  if (l === current) return;
  current = l;
  try {
    localStorage.setItem(KEY, l);
  } catch {
    /* 無視 */
  }
  document.documentElement.lang = l;
  listeners.forEach((f) => f());
}

const subscribe = (f: () => void) => {
  listeners.add(f);
  return () => listeners.delete(f);
};

export const useLang = () => useSyncExternalStore(subscribe, getLang, getLang);

/** React の外で使う翻訳（呼んだ時点の言語） */
export const tr = (ja: string, en: string) => (current === 'en' ? en : ja);

/** 部品の中で使う翻訳。言語が変わると部品が描き直される */
export function useT() {
  const lang = useLang();
  const t = useCallback((ja: string, en: string) => (lang === 'en' ? en : ja), [lang]);
  return { lang, t, en: lang === 'en' };
}

/** { ja, en } の組から選ぶ */
export const pick = <T,>(v: { ja: T; en: T }, lang: Lang = current) => (lang === 'en' ? v.en : v.ja);
