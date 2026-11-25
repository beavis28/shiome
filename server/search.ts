// ウェブ検索: Exa と Tavily を同時に呼び、結果を 1 つにまとめる。
//  - URL を正規化して重複を除き、両方で見つかったページを上位に置く（信頼の目安）
//  - 片方のキーしかなくても、ある方だけで検索する
import { tx } from './lang.ts';
import { exaSearch } from './exa.ts';

export type Provider = 'Exa' | 'Tavily';
export interface SearchHit {
  title: string;
  url: string;
  date: string | null; // YYYY-MM-DD
  snippets: string[];
  providers: Provider[];
}
export interface SearchOptions {
  query: string;
  days?: number;
  topic?: 'general' | 'news' | 'finance';
}

export const searchProviders = (): Provider[] => [
  ...(process.env.EXA_API_KEY ? (['Exa'] as const) : []),
  ...(process.env.TAVILY_API_KEY ? (['Tavily'] as const) : []),
];

const ymd = (v: string | null | undefined) => {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
};

function normUrl(u: string) {
  try {
    const x = new URL(u);
    return (x.hostname.replace(/^www\./, '') + x.pathname.replace(/\/+$/, '')).toLowerCase();
  } catch {
    return u.toLowerCase();
  }
}

async function tavilySearch(o: SearchOptions): Promise<SearchHit[]> {
  const key = process.env.TAVILY_API_KEY;
  if (!key) throw new Error(tx('TAVILY_API_KEY が未設定です', 'TAVILY_API_KEY is not set'));
  const body: Record<string, unknown> = {
    query: o.query,
    search_depth: 'advanced', // 2 クレジット。ページ内の関連箇所を複数抜き出してくれる
    chunks_per_source: 3,
    max_results: 6,
    topic: o.topic ?? 'general',
    include_published_date: true,
  };
  if (o.days && o.days > 0) body.start_date = new Date(Date.now() - o.days * 86400_000).toISOString().slice(0, 10);
  const res = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    if (res.status === 401) throw new Error(tx('TAVILY_API_KEY が正しくありません', 'TAVILY_API_KEY is invalid'));
    if (res.status === 429 || res.status === 432 || res.status === 433) throw new Error(tx('Tavily の利用上限に達しました', 'Tavily usage limit reached'));
    throw new Error(tx(`Tavily エラー (${res.status})`, `Tavily error (${res.status})`));
  }
  const json = (await res.json()) as { results?: { title?: string; url?: string; content?: string; published_date?: string | null }[] };
  return (json.results ?? [])
    .filter((r) => r.url)
    .map((r) => ({
      title: String(r.title ?? ''),
      url: String(r.url),
      date: ymd(r.published_date),
      snippets: r.content ? [r.content.slice(0, 1500)] : [],
      providers: ['Tavily'],
    }));
}

async function exaHits(o: SearchOptions): Promise<SearchHit[]> {
  const found = await exaSearch({ query: o.query, days: o.days, newsOnly: o.topic === 'news', numResults: 6 });
  return found.map((r) => ({
    title: r.title,
    url: r.url,
    date: ymd(r.publishedDate),
    snippets: r.highlights.length ? r.highlights : r.text ? [r.text.slice(0, 1200)] : [],
    providers: ['Exa'],
  }));
}

export async function webSearch(o: SearchOptions): Promise<{ hits: SearchHit[]; errors: string[] }> {
  const providers = searchProviders();
  if (!providers.length) throw new Error(tx('検索の API キー（EXA_API_KEY / TAVILY_API_KEY）が未設定です', 'No search API key is set (EXA_API_KEY / TAVILY_API_KEY)'));
  const runs = await Promise.allSettled(providers.map((p) => (p === 'Exa' ? exaHits(o) : tavilySearch(o))));
  const errors: string[] = [];
  const lists: SearchHit[][] = runs.map((r, i) => {
    if (r.status === 'fulfilled') return r.value;
    errors.push(`${providers[i]}: ${r.reason instanceof Error ? r.reason.message : r.reason}`);
    return [];
  });
  if (lists.every((l) => !l.length) && errors.length === providers.length) throw new Error(errors.join(' / '));

  // 交互に並べながら重複をまとめる（Exa 1 位, Tavily 1 位, Exa 2 位, ...）
  const merged = new Map<string, SearchHit>();
  const order: string[] = [];
  for (let k = 0; k < Math.max(...lists.map((l) => l.length)); k++) {
    for (const list of lists) {
      const h = list[k];
      if (!h) continue;
      const key = normUrl(h.url);
      const cur = merged.get(key);
      if (cur) {
        cur.providers = [...new Set([...cur.providers, ...h.providers])].sort() as Provider[];
        cur.snippets = [...cur.snippets, ...h.snippets].slice(0, 4);
        cur.date ??= h.date;
        if (!cur.title) cur.title = h.title;
      } else {
        merged.set(key, { ...h });
        order.push(key);
      }
    }
  }
  const hits = order.map((k) => merged.get(k)!);
  // 両方の検索で見つかったページを先頭に（順番は保つ）
  hits.sort((a, b) => b.providers.length - a.providers.length);
  return { hits: hits.slice(0, 10), errors };
}
