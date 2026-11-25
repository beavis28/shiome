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
    const html = res.ok ? await res.text() : '';
    const m = html.match(/<link rel="canonical" href="https:\/\/www\.youtube\.com\/watch\?v=([\w-]{11})"/);
    const live = /"isLive(?:Now)?":true/.test(html);
    if (!m || !live) {
      // 取れなかった理由を調べるためのログ（同意画面・ボット確認・ライブ終了など）
      console.warn('tv: no live id', channelId, res.status, res.url.slice(0, 80), html.length, {
        canonical: html.match(/<link rel="canonical" href="([^"]+)"/)?.[1]?.slice(0, 80),
        consent: /consent\.youtube|before you continue/i.test(html),
        bot: /not a bot|unusual traffic|captcha/i.test(html),
        live,
      });
    }
    return m && live ? m[1] : null;
  }, (v) => (v ? 15 * MIN : 2 * MIN)); // 取れなかったときは早めに取り直す
}
