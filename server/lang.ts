// サーバーのメッセージ（エラーなど）の言語。画面が X-Lang ヘッダーで知らせる
import { AsyncLocalStorage } from 'node:async_hooks';

export type Lang = 'ja' | 'en';
const store = new AsyncLocalStorage<Lang>();

export const langOf = (header: string | undefined | null): Lang => (header === 'en' ? 'en' : 'ja');
export const withLang = <T>(lang: Lang, fn: () => T): T => store.run(lang, fn);
export const currentLang = (): Lang => store.getStore() ?? 'ja';

/** 今のリクエストの言語でメッセージを選ぶ */
export const tx = (ja: string, en: string) => (currentLang() === 'en' ? en : ja);
