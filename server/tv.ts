// 各チャンネルの「いまのライブ動画」の ID を調べる（YouTube の /live ページの canonical から）。
// チャンネル指定の埋め込み（live_stream?channel=）は、同時に複数配信しているチャンネルなどで再生できないため。
import { cached, MIN } from './cache.ts';

const CHANNEL_RE = /^UC[\w-]{22}$/;

export async function liveVideoId(channelId: string): Promise<string | null> {
  if (!CHANNEL_RE.test(channelId)) return null;
  return cached(`tv:live:${channelId}`, 15 * MIN, async () => {
    const res = await fetch(`https://www.youtube.com/channel/${channelId}/live`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9',
        Cookie: 'CONSENT=YES+cb; SOCS=CAI', // 同意画面に飛ばされないように
      },
      redirect: 'follow',
    });
    if (!res.ok) return null;
    const html = await res.text();
    const m = html.match(/<link rel="canonical" href="https:\/\/www\.youtube\.com\/watch\?v=([\w-]{11})"/);
    return m && /"isLive(?:Now)?":true/.test(html) ? m[1] : null;
  });
}
