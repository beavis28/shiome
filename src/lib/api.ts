import type { AppConfig, EconPayload, NewsItem, OcrTicker, Quote, StockPayload, ValuationPayload, HeatmapPayload, MacroPayload } from '../types';

async function getJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
  return body as T;
}

export const api = {
  config: () => getJson<AppConfig>('/api/config'),
  stock: (symbol: string) => getJson<StockPayload>(`/api/stock/${encodeURIComponent(symbol)}`),
  quotes: (symbols: string[]) =>
    getJson<{ quotes: Record<string, Quote>; at: string }>(`/api/quotes?symbols=${encodeURIComponent(symbols.join(','))}`),
  news: (symbol: string) => getJson<{ news: NewsItem[] }>(`/api/news/${encodeURIComponent(symbol)}`),
  valuation: (symbols: string[]) => getJson<ValuationPayload>(`/api/valuation?symbols=${encodeURIComponent(symbols.join(','))}`),
  heatmap: (universe: 'major' | 'watchlist', symbols: string[]) =>
    getJson<HeatmapPayload>(`/api/heatmap?universe=${universe}${symbols.length ? `&symbols=${encodeURIComponent(symbols.join(','))}` : ''}`),
  macro: () => getJson<MacroPayload>('/api/macro'),
  me: () => getJson<{ email: string | null }>('/api/me'),
  /** 相談チャット（回答はテキストのストリームで返る） */
  chat: async (messages: { role: 'user' | 'assistant'; content: string }[], dashboard: unknown, webSearch: boolean, signal?: AbortSignal) => {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages, dashboard, webSearch }),
      signal,
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
    }
    return res;
  },
  econ: () => getJson<EconPayload>('/api/econ'),
  validate: (symbols: string[]) =>
    getJson<{ checked: boolean; results: Record<string, { name: string; exchange: string } | null> }>(
      `/api/validate?symbols=${encodeURIComponent(symbols.join(','))}`,
    ),
  ocr: (images: { data: string; mediaType: string }[]) =>
    getJson<{ tickers: OcrTicker[] }>('/api/ocr', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ images }),
    }),
};
