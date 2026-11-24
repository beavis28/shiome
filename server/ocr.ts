// Claude（画像対応 LLM）でスクリーンショットからティッカーを読み取る
import Anthropic from '@anthropic-ai/sdk';
import type { OcrTicker } from '../src/types.ts';

const SCHEMA = {
  type: 'object',
  properties: {
    tickers: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          symbol: { type: 'string' },
          name: { type: ['string', 'null'] },
          confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
        },
        required: ['symbol', 'name', 'confidence'],
        additionalProperties: false,
      },
    },
  },
  required: ['tickers'],
  additionalProperties: false,
} as const;

const PROMPT = `This image is a screenshot or photo of a brokerage app, watchlist, or stock list.
List every US-listed stock or ETF that appears in it.
- symbol: the ticker in upper case (e.g. AAPL, NVDA, BRK.B). If only the company name is shown, give its primary US ticker and set confidence to "medium".
- name: the company name if visible or known, otherwise null.
- confidence: "high" if the ticker is clearly printed, "medium" if inferred, "low" if partly unreadable.
Ignore indices (S&P 500, Nasdaq, Dow), currencies, crypto, and UI labels. Do not repeat a ticker.`;

const MEDIA = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'] as const;
type Media = (typeof MEDIA)[number];

let client: Anthropic | null = null;

export async function readTickersWithClaude(images: { data: string; mediaType: string }[]): Promise<OcrTicker[]> {
  client ??= new Anthropic(); // ANTHROPIC_API_KEY を環境変数から読む
  const content: Anthropic.Beta.BetaContentBlockParam[] = [];
  for (const img of images) {
    const mediaType = (MEDIA as readonly string[]).includes(img.mediaType) ? (img.mediaType as Media) : 'image/jpeg';
    content.push({ type: 'image', source: { type: 'base64', media_type: mediaType, data: img.data } });
  }
  content.push({ type: 'text', text: PROMPT });

  const res = await client.beta.messages.create({
    model: 'claude-opus-5-5',
    max_tokens: 16000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA } },
    messages: [{ role: 'user', content }],
  });

  if (res.stop_reason === 'refusal') throw new Error('画像を読み取れませんでした（リクエストが拒否されました）');
  if (res.stop_reason === 'max_tokens') throw new Error('応答が長すぎて途中で切れました。画像の枚数を減らしてください');
  const text = res.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('');
  const parsed = JSON.parse(text) as { tickers: OcrTicker[] };
  const seen = new Set<string>();
  return parsed.tickers
    .map((t) => ({ ...t, symbol: t.symbol.trim().toUpperCase().replace(/\s+/g, '') }))
    .filter((t) => /^[A-Z]{1,5}([.-][A-Z]{1,2})?$/.test(t.symbol) && !seen.has(t.symbol) && seen.add(t.symbol));
}
