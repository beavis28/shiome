// Exa（https://exa.ai）によるウェブ検索。相談チャットのツールとして使う。
export interface ExaResult {
  title: string;
  url: string;
  publishedDate: string | null;
  author: string | null;
  highlights: string[];
  text: string | null;
}

export async function exaSearch(opts: { query: string; days?: number; newsOnly?: boolean; numResults?: number }): Promise<ExaResult[]> {
  const key = process.env.EXA_API_KEY;
  if (!key) throw new Error('EXA_API_KEY が未設定です');
  const body: Record<string, unknown> = {
    query: opts.query,
    type: 'auto',
    numResults: Math.min(Math.max(opts.numResults ?? 6, 1), 10),
    contents: { highlights: { maxCharacters: 1200 }, text: { maxCharacters: 1500 } },
  };
  if (opts.days && opts.days > 0) body.startPublishedDate = new Date(Date.now() - opts.days * 86400_000).toISOString();
  if (opts.newsOnly) body.category = 'news';
  const res = await fetch('https://api.exa.ai/search', {
    method: 'POST',
    headers: { 'x-api-key': key, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    if (res.status === 401 || res.status === 403) throw new Error('EXA_API_KEY が正しくありません');
    if (res.status === 429) throw new Error('Exa の呼び出し上限に達しました');
    throw new Error(`Exa エラー (${res.status})`);
  }
  const json = (await res.json()) as { results?: Record<string, unknown>[] };
  return (json.results ?? []).map((r) => ({
    title: String(r.title ?? ''),
    url: String(r.url ?? ''),
    publishedDate: typeof r.publishedDate === 'string' ? r.publishedDate : null,
    author: typeof r.author === 'string' ? r.author : null,
    highlights: Array.isArray(r.highlights) ? (r.highlights as unknown[]).map(String).slice(0, 3) : [],
    text: typeof r.text === 'string' ? r.text : null,
  }));
}
