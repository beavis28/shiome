// ウォッチリストはこのブラウザの localStorage に保存する
const KEY = 'usdash.watchlist.v1';
export const DEFAULT_WATCHLIST = ['AAPL', 'NVDA', 'MSFT', 'TSLA'];
const DEFAULT = DEFAULT_WATCHLIST;

export function loadWatchlist(): string[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const list = JSON.parse(raw);
      if (Array.isArray(list)) return list.filter((s) => typeof s === 'string');
    }
  } catch {
    /* 使えない環境ではデフォルト */
  }
  return DEFAULT;
}

export function saveWatchlist(list: string[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    /* 無視 */
  }
}
