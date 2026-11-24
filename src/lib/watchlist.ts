// ウォッチリストはこのブラウザの localStorage に保存する
const KEY = 'usdash.watchlist.v1';
const DEFAULT = ['AAPL', 'NVDA', 'MSFT', 'TSLA'];

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
