import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import type { NewsItem } from '../types';
import { Card } from './ui';

function ago(iso: string) {
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (min < 1) return 'たった今';
  if (min < 60) return `${min}分前`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h}時間前`;
  return `${Math.round(h / 24)}日前`;
}

/** 選択中の銘柄のニュース（Yahoo Finance）。refreshKey が変わると再取得 */
export function NewsPanel({ symbol, refreshKey }: { symbol: string | null; refreshKey: number }) {
  const [state, setState] = useState<{ symbol: string; news: NewsItem[]; error: string | null } | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!symbol) return;
    let alive = true;
    setLoading(true);
    api.news(symbol).then(
      (r) => alive && setState({ symbol, news: r.news, error: null }),
      (e) => alive && setState({ symbol, news: [], error: e instanceof Error ? e.message : String(e) }),
    ).finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [symbol, refreshKey]);

  const news = state?.symbol === symbol ? state.news : [];
  return (
    <Card
      title={`ニュース${symbol ? ` · ${symbol}` : ''}`}
      className="flex min-h-0 min-w-0 flex-col"
      right={<span className="text-[10px] text-mute">{loading ? '更新中…' : 'Yahoo Finance'}</span>}
    >
      <ul className="min-h-0 flex-1 overflow-auto">
        {state?.symbol === symbol && state.error && <li className="p-3 text-xs text-downc">{state.error}</li>}
        {news.map((n) => {
          const direct = symbol ? n.related.includes(symbol) : false;
          return (
            <li key={n.id} className="border-b border-line/50 last:border-0">
              <a href={n.link} target="_blank" rel="noreferrer noopener" className="flex gap-2 px-2.5 py-1.5 hover:bg-white/[0.04]">
                {n.thumbnail && <img src={n.thumbnail} alt="" loading="lazy" referrerPolicy="no-referrer" className="h-10 w-14 shrink-0 rounded object-cover" />}
                <div className="min-w-0 flex-1">
                  <p className={`line-clamp-2 text-xs leading-snug ${direct ? 'text-ink' : 'text-mute'}`}>{n.title}</p>
                  <p className="mt-0.5 truncate text-[10px] text-mute">
                    {n.publisher} · {ago(n.time)}
                    {n.related.length > 0 && <span className="ml-1 text-accent/80">{n.related.slice(0, 4).join(' ')}</span>}
                  </p>
                </div>
              </a>
            </li>
          );
        })}
        {!loading && state?.symbol === symbol && !news.length && !state.error && <li className="p-3 text-xs text-mute">ニュースはありません</li>}
      </ul>
    </Card>
  );
}
