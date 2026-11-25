// 無料枠（FMP 250回/日）を節約するための簡易キャッシュ。
// 1 段目: プロセス（Workers ではアイソレート）内のメモリ
// 2 段目: 永続ストア（Node はローカルの .cache/、Workers は KV）。TTL が長いものだけ保存する
export interface CacheStore {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, ttlSec: number): Promise<void>;
}

const mem = new Map<string, { exp: number; value: unknown }>();
let store: CacheStore | null = null;

export function setCacheStore(s: CacheStore | null) {
  store = s;
}

/** これより短い TTL は永続ストアに書かない（KV の書き込み回数を節約） */
const PERSIST_MIN_MS = 30 * 60_000;

/** ttlFor を渡すと、取れた値に応じて保存期間を変えられる（一部しか取れなかったときは短くする など） */
export async function cached<T>(key: string, ttlMs: number, fn: () => Promise<T>, ttlFor?: (value: T) => number): Promise<T> {
  const now = Date.now();
  const hit = mem.get(key);
  if (hit && hit.exp > now) return hit.value as T;
  let persist = store && ttlMs >= PERSIST_MIN_MS;
  if (persist) {
    try {
      const raw = await store!.get(key);
      if (raw) {
        const entry = JSON.parse(raw) as { exp: number; value: T };
        if (entry.exp > now) {
          mem.set(key, entry);
          return entry.value;
        }
      }
    } catch {
      /* 読めなければ取り直す */
    }
  }
  const value = await fn();
  if (ttlFor) ttlMs = ttlFor(value);
  const entry = { exp: now + ttlMs, value };
  persist = store && ttlMs >= PERSIST_MIN_MS;
  mem.set(key, entry);
  if (mem.size > 500) mem.delete(mem.keys().next().value!);
  if (persist) {
    try {
      await store!.put(key, JSON.stringify(entry), Math.max(60, Math.ceil(ttlMs / 1000)));
    } catch {
      /* 書き込み失敗は無視 */
    }
  }
  return value;
}

export const MIN = 60_000;
export const HOUR = 60 * MIN;
