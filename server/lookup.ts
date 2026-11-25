// ティッカーの候補探し。打ち間違い（NVIDA → NVDA）、会社名（apple）、日本語名（エヌビディア）から候補を出す
// - Yahoo Finance の検索: 会社名・ETF に強い
// - SEC の米国上場企業の一覧（約 1 万社）: 1〜2 文字違いのティッカー・社名を拾う
// - よく調べられる会社の日本語名
import type { SymbolHit } from '../src/types.ts';
import { cached, HOUR } from './cache.ts';
import { sec } from './smart.ts';
import { yahooRaw } from './yahoo.ts';

// 米国の取引所（Yahoo の略号）
const US = new Set(['NMS', 'NGM', 'NCM', 'NYQ', 'ASE', 'PCX', 'BTS', 'NAS', 'NYS', 'BATS', 'CBOE']);
const EXCHANGE: Record<string, string> = { NMS: 'NASDAQ', NGM: 'NASDAQ', NCM: 'NASDAQ', NAS: 'NASDAQ', NYQ: 'NYSE', NYS: 'NYSE', ASE: 'NYSE American', PCX: 'NYSE Arca', BTS: 'Cboe', BATS: 'Cboe', CBOE: 'Cboe' };

const JA: [RegExp, string[]][] = [
  [/エヌビディア|エヌビデア/, ['NVDA']],
  [/アップル/, ['AAPL']],
  [/マイクロソフト/, ['MSFT']],
  [/アマゾン/, ['AMZN']],
  [/グーグル|アルファベット/, ['GOOGL', 'GOOG']],
  [/メタ|フェイスブック/, ['META']],
  [/テスラ/, ['TSLA']],
  [/ブロードコム/, ['AVGO']],
  [/パランティア/, ['PLTR']],
  [/ネットフリックス/, ['NFLX']],
  [/インテル/, ['INTC']],
  [/クアルコム/, ['QCOM']],
  [/マイクロン/, ['MU']],
  [/オラクル/, ['ORCL']],
  [/セールスフォース/, ['CRM']],
  [/アドビ/, ['ADBE']],
  [/台湾積体|TSMC/i, ['TSM']],
  [/ASML/i, ['ASML']],
  [/バークシャー/, ['BRK.B', 'BRK.A']],
  [/コカ.?コーラ/, ['KO']],
  [/ペプシ/, ['PEP']],
  [/マクドナルド/, ['MCD']],
  [/スターバックス/, ['SBUX']],
  [/ナイキ/, ['NKE']],
  [/ディズニー/, ['DIS']],
  [/ウォルマート/, ['WMT']],
  [/コストコ/, ['COST']],
  [/ビザ/, ['V']],
  [/マスターカード/, ['MA']],
  [/JPモルガン/i, ['JPM']],
  [/ゴールドマン/, ['GS']],
  [/バンク.?オブ.?アメリカ/, ['BAC']],
  [/イーライ.?リリー|リリー/, ['LLY']],
  [/ノボ/, ['NVO']],
  [/ファイザー/, ['PFE']],
  [/ジョンソン/, ['JNJ']],
  [/ユナイテッドヘルス/, ['UNH']],
  [/エクソン/, ['XOM']],
  [/シェブロン/, ['CVX']],
  [/ボーイング/, ['BA']],
  [/キャタピラー/, ['CAT']],
  [/ウーバー/, ['UBER']],
  [/エアビー/, ['ABNB']],
  [/ショッピファイ/, ['SHOP']],
  [/スノーフレーク/, ['SNOW']],
  [/クラウドストライク/, ['CRWD']],
  [/コインベース/, ['COIN']],
  [/ロビンフッド/, ['HOOD']],
  [/ソフィ/, ['SOFI']],
  [/アーム/, ['ARM']],
  [/スーパーマイクロ/, ['SMCI']],
  [/ストラテジー|マイクロストラテジー/, ['MSTR']],
  [/S&P\s?500|エスアンドピー/i, ['SPY', 'VOO', 'IVV']],
  [/ナスダック/, ['QQQ']],
  [/全米|オルカン|全世界/, ['VTI', 'VT']],
];

const COMPANY_NORM = (s: string) =>
  s
    .toUpperCase()
    .replace(/[.,'&()/-]/g, ' ')
    .replace(/\b(INC|CORP|CORPORATION|CO|LTD|PLC|HOLDINGS?|GROUP|THE|CLASS|COMMON|STOCK|SA|NV|AG|SE)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/** SEC の米国上場企業の一覧 [ティッカー, 社名, CIK]（7 日キャッシュ） */
export function companies() {
  return cached(`sec:companies:v2`, 7 * 24 * HOUR, async () => {
    const d = (await (await sec('https://www.sec.gov/files/company_tickers.json')).json()) as Record<string, { ticker: string; title: string; cik_str: number }>;
    return Object.values(d).map((r) => [r.ticker.replace('-', '.'), r.title, r.cik_str] as [string, string, number]);
  });
}

/** ティッカーから SEC の CIK（10 桁）を引く */
export async function cikOf(symbol: string): Promise<string | null> {
  const hit = (await companies()).find(([t]) => t === symbol);
  return hit ? String(hit[2]).padStart(10, '0') : null;
}

/** 編集距離（打ち間違いの近さ）。隣り合う 2 文字の入れ替え（APLP → AAPL）も 1 回と数える */
function dist(a: string, b: string, max: number) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const d = Array.from({ length: a.length + 1 }, (_, i) => Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)));
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[a.length][b.length];
}

type Scored = SymbolHit & { score: number };

async function fromYahoo(q: string): Promise<Scored[]> {
  try {
    const r = (await yahooRaw().search(q.replace('.', '-'), { quotesCount: 10, newsCount: 0 }, { validateResult: false })) as { quotes?: Record<string, unknown>[] };
    return (r.quotes ?? [])
      .filter((x) => US.has(String(x.exchange)) && (x.quoteType === 'EQUITY' || x.quoteType === 'ETF'))
      .map((x, i) => ({
        symbol: String(x.symbol).replace('-', '.'),
        name: String(x.longname ?? x.shortname ?? ''),
        exchange: EXCHANGE[String(x.exchange)] ?? String(x.exchange),
        type: x.quoteType === 'ETF' ? ('ETF' as const) : ('株式' as const),
        score: 50 - i * 3,
      }));
  } catch {
    return []; // 日本語などは Yahoo がエラーを返す
  }
}

async function fromSec(q: string): Promise<Scored[]> {
  const list = await companies().catch(() => [] as [string, string, number][]);
  const Q = q.toUpperCase();
  const qn = COMPANY_NORM(q);
  const out: Scored[] = [];
  for (const [ticker, title] of list) {
    let score = 0;
    if (ticker === Q) score = 100;
    else if (/^[A-Z.]{2,6}$/.test(Q) && Q.length >= 3) {
      const d = dist(Q, ticker, 1);
      if (d === 1) score = 40;
    }
    if (qn.length >= 3) {
      const n = COMPANY_NORM(title);
      const first = n.split(' ')[0] ?? '';
      if (n === qn) score = Math.max(score, 70);
      else if (n.startsWith(qn + ' ') || first === qn) score = Math.max(score, 60);
      else if (qn.length >= 4 && dist(qn, first, qn.length >= 7 ? 2 : 1) <= (qn.length >= 7 ? 2 : 1)) score = Math.max(score, 45);
    }
    if (score) out.push({ symbol: ticker, name: title, exchange: '', type: '株式', score });
  }
  return out.sort((a, b) => b.score - a.score).slice(0, 12);
}

/** 入力に近い銘柄の候補。exact は入力そのものが実在するティッカーか（1 日キャッシュ） */
export function lookupSymbols(raw: string): Promise<{ query: string; exact: SymbolHit | null; suggestions: SymbolHit[] }> {
  const q = raw.trim().slice(0, 40);
  return cached(`lookup:v1:${q.toUpperCase()}`, 24 * HOUR, async () => {
    const ja = JA.filter(([re]) => re.test(q)).flatMap(([, syms]) => syms);
    const [y, s] = await Promise.all([
      /[぀-ヿ一-鿿]/.test(q) ? Promise.resolve([] as Scored[]) : fromYahoo(q),
      /^[\x20-\x7e]+$/.test(q) ? fromSec(q) : Promise.resolve([] as Scored[]),
    ]);
    // 日本語名の候補は、名前を SEC / Yahoo から引く
    const jaHits: Scored[] = [];
    for (const [i, sym] of ja.entries()) {
      const hit = (await fromYahoo(sym)).find((h) => h.symbol === sym);
      jaHits.push(hit ? { ...hit, score: 90 - i } : { symbol: sym, name: '', exchange: '', type: '株式', score: 90 - i });
    }
    // 同じ銘柄は 1 つにまとめ、取引所などの情報は Yahoo を優先する
    const by = new Map<string, Scored>();
    for (const h of [...jaHits, ...y, ...s]) {
      const cur = by.get(h.symbol);
      if (!cur) by.set(h.symbol, { ...h });
      else {
        cur.score = Math.max(cur.score, h.score) + 5; // 両方で見つかったものは少し上げる
        cur.exchange ||= h.exchange;
        cur.name ||= h.name;
      }
    }
    const all = [...by.values()].sort((a, b) => b.score - a.score);
    const Q = q.toUpperCase();
    const exact = all.find((h) => h.symbol === Q) ?? null;
    const strip = ({ score: _s, ...h }: Scored): SymbolHit => h;
    return { query: q, exact: exact && strip(exact), suggestions: all.slice(0, 7).map(strip) };
  });
}
