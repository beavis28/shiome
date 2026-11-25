// ログインしている人（Cloudflare Access のメールアドレス）ごとの設定を保存する。
// ウォッチリストなどを端末をまたいで同期するため。Workers では KV、手元（ログインなし）では使わない。
import { tx } from './lang.ts';
import type { Prefs } from '../src/types.ts';

export interface PrefsStore {
  get(key: string): Promise<string | null>;
  put(key: string, value: string): Promise<void>;
}

let store: PrefsStore | null = null;
export function setPrefsStore(s: PrefsStore | null) {
  store = s;
}
export const prefsAvailable = () => !!store;

const SYMBOL_RE = /^[A-Z]{1,5}([.-][A-Z]{1,2})?$/;
const METRIC_RE = /^[a-zA-Z]{2,20}$/;

async function keyFor(email: string) {
  const data = new TextEncoder().encode(email.trim().toLowerCase());
  const hash = await crypto.subtle.digest('SHA-256', data);
  return 'prefs:' + [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** 受け取った設定を検証して、知っている項目だけ残す */
export function sanitize(raw: unknown): Prefs | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const syms = (v: unknown, n: number) =>
    Array.isArray(v) ? [...new Set(v.map((x) => String(x).toUpperCase().trim()).filter((x) => SYMBOL_RE.test(x)))].slice(0, n) : undefined;
  const metrics = Array.isArray(o.compareMetrics) ? o.compareMetrics.map(String).filter((x) => METRIC_RE.test(x)).slice(0, 4) : undefined;
  const watchlist = syms(o.watchlist, 100);
  if (!watchlist) return null;
  return {
    watchlist,
    compareSymbols: syms(o.compareSymbols, 20) ?? [],
    compareMetrics: metrics ?? [],
    updatedAt: typeof o.updatedAt === 'number' && Number.isFinite(o.updatedAt) ? o.updatedAt : Date.now(),
  };
}

export async function loadPrefs(email: string): Promise<Prefs | null> {
  if (!store) return null;
  const raw = await store.get(await keyFor(email));
  if (!raw) return null;
  try {
    return sanitize(JSON.parse(raw));
  } catch {
    return null;
  }
}

/** 新しいほう（updatedAt が大きいほう）を残す。保存した結果を返す */
export async function savePrefs(email: string, prefs: Prefs): Promise<Prefs> {
  if (!store) throw new Error(tx('同期の保存先がありません', 'No storage for sync'));
  const cur = await loadPrefs(email);
  if (cur && cur.updatedAt > prefs.updatedAt) return cur;
  await store.put(await keyFor(email), JSON.stringify(prefs));
  return prefs;
}
