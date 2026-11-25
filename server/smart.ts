// 有名投資家・役員・議員の売買記録
// - 有名ファンドの保有: SEC EDGAR の 13F（四半期ごと、期末から最大 45 日遅れ）。CUSIP → ティッカーは OpenFIGI
// - 役員の売買・大口保有機関: Yahoo Finance（元は SEC の Form 4 / 13F）
// - 議員の売買: FMP（上院・下院の STOCK Act 報告。プランによっては取れない）
import type { CongressTrade, FundHoldings, FundPosition, FundSummary, Ownership } from '../src/types.ts';
import { cached, HOUR } from './cache.ts';
import { fmp } from './fmp.ts';
import { yahooRaw } from './yahoo.ts';

export const FUNDS: FundSummary[] = [
  { cik: '0001067983', fund: 'Berkshire Hathaway', manager: 'ウォーレン・バフェット' },
  { cik: '0001336528', fund: 'Pershing Square', manager: 'ビル・アックマン' },
  { cik: '0001536411', fund: 'Duquesne Family Office', manager: 'スタンレー・ドラッケンミラー' },
  { cik: '0001656456', fund: 'Appaloosa', manager: 'デビッド・テッパー' },
  { cik: '0001697748', fund: 'ARK Investment', manager: 'キャシー・ウッド' },
  { cik: '0001061768', fund: 'Baupost Group', manager: 'セス・クラーマン' },
  { cik: '0001709323', fund: 'Himalaya Capital', manager: 'リー・ルー' },
  { cik: '0000921669', fund: 'Icahn Enterprises', manager: 'カール・アイカーン' },
  { cik: '0001040273', fund: 'Third Point', manager: 'ダニエル・ローブ' },
  { cik: '0001167483', fund: 'Tiger Global', manager: 'チェイス・コールマン' },
  { cik: '0001029160', fund: 'Soros Fund Management', manager: 'ジョージ・ソロス' },
  { cik: '0001350694', fund: 'Bridgewater Associates', manager: 'レイ・ダリオ（創業者）' },
];

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : typeof v === 'string' ? v : null);
const day = (v: unknown) => iso(v)?.slice(0, 10) ?? null;

// ---------------------------------------------------------------- SEC 13F

/** SEC は連絡先（名前とメールアドレス）入りの User-Agent を求める。各自が .env / Secret に設定する */
async function sec(url: string): Promise<Response> {
  const ua = process.env.SEC_USER_AGENT;
  if (!ua) throw new Error('SEC_USER_AGENT が未設定です');
  const res = await fetch(url, { headers: { 'User-Agent': ua, Accept: 'application/json, application/xml, */*' } });
  if (res.status === 403) throw new Error('SEC に拒否されました（SEC_USER_AGENT に名前とメールアドレスを入れてください）');
  if (!res.ok) throw new Error(`SEC エラー (${res.status})`);
  return res;
}

type Filing = { accession: string; reportDate: string; filingDate: string };

async function latest13F(cik: string): Promise<Filing[]> {
  const d = (await (await sec(`https://data.sec.gov/submissions/CIK${cik}.json`)).json()) as {
    filings: { recent: { form: string[]; reportDate: string[]; filingDate: string[]; accessionNumber: string[] } };
  };
  const r = d.filings.recent;
  const out: Filing[] = [];
  for (let i = 0; i < r.form.length && out.length < 2; i++) {
    // 同じ期の訂正（13F-HR/A）は使わず、各期の最初の届け出を使う
    if (r.form[i] !== '13F-HR' || out.some((f) => f.reportDate === r.reportDate[i])) continue;
    out.push({ accession: r.accessionNumber[i], reportDate: r.reportDate[i], filingDate: r.filingDate[i] });
  }
  return out;
}

type Row = { cusip: string; name: string; cls: string; value: number; shares: number; putCall: string | null };

async function infoTable(cik: string, accession: string): Promise<Row[]> {
  const base = `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${accession.replace(/-/g, '')}`;
  const idx = (await (await sec(`${base}/index.json`)).json()) as { directory: { item: { name: string }[] } };
  const file = idx.directory.item.map((i) => i.name).find((n) => /\.xml$/i.test(n) && !/primary_doc/i.test(n));
  if (!file) throw new Error('13F の保有一覧が見つかりません');
  const xml = await (await sec(`${base}/${file}`)).text();
  const tag = (block: string, name: string) => decode(block.match(new RegExp(`<(?:\\w+:)?${name}>([^<]*)<`, 'i'))?.[1].trim() ?? '');
  // 同じ銘柄が運用者ごとに複数行に分かれているので、CUSIP（とプット・コール）ごとに合算する
  const rows = new Map<string, Row>();
  for (const m of xml.matchAll(/<(?:\w+:)?infoTable>([\s\S]*?)<\/(?:\w+:)?infoTable>/gi)) {
    const b = m[1];
    const cusip = tag(b, 'cusip').toUpperCase();
    const putCall = tag(b, 'putCall') || null;
    const key = `${cusip}|${putCall ?? ''}`;
    const value = Number(tag(b, 'value')) || 0;
    const shares = Number(tag(b, 'sshPrnamt')) || 0;
    const cur = rows.get(key);
    if (cur) {
      cur.value += value;
      cur.shares += shares;
    } else rows.set(key, { cusip, name: tag(b, 'nameOfIssuer'), cls: tag(b, 'titleOfClass'), value, shares, putCall });
  }
  const list = [...rows.values()];
  // 2023 年からは金額をドルで書く決まりだが、千ドル単位のままの届け出もある。1 株あたりの値段で見分ける
  const prices = list.filter((r) => r.shares > 0 && !r.putCall).map((r) => r.value / r.shares).sort((a, b) => a - b);
  if (prices.length && prices[Math.floor(prices.length / 2)] < 2) for (const r of list) r.value *= 1000;
  return list;
}

const decode = (s: string) =>
  s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&(apos|#39);/g, "'");

// 会社名を比べやすい形にする（"AMAZON COM INC" と "Amazon.com, Inc." を同じにする）
const SUFFIX = /\b(INC|INCORPORATED|CORP|CORPORATION|CO|COMPANY|LTD|LIMITED|PLC|HLDGS|HOLDINGS?|GROUP|GRP|THE|NV|SA|AG|SE|LP|LLC|COM|CL|CLASS|NEW|DEL|ORD|SHS|ADR|SPONSORED|A|B|C)\b/g;
const norm = (s: string) =>
  s
    .toUpperCase()
    .replace(/[.,'&()/-]/g, ' ')
    .replace(SUFFIX, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/** SEC の会社一覧（名前 → ティッカー）。同じ会社に複数のティッカーがあるもの（クラス株）は外す（7 日キャッシュ） */
function secNames() {
  return cached(`sec:names:v1`, 7 * 24 * HOUR, async () => {
    const d = (await (await sec('https://www.sec.gov/files/company_tickers.json')).json()) as Record<string, { cik_str: number; ticker: string; title: string }>;
    const byCik = new Map<number, string[]>();
    for (const r of Object.values(d)) byCik.set(r.cik_str, [...(byCik.get(r.cik_str) ?? []), r.ticker]);
    const out: Record<string, string> = {};
    const dup = new Set<string>();
    for (const r of Object.values(d)) {
      if ((byCik.get(r.cik_str)?.length ?? 0) > 1) continue;
      const k = norm(r.title);
      if (!k) continue;
      if (out[k] && out[k] !== r.ticker) dup.add(k);
      else out[k] = r.ticker.replace('-', '.');
    }
    for (const k of dup) delete out[k];
    return out;
  });
}

const figiMemo = new Map<string, string>();

/**
 * CUSIP からティッカーを調べる。まず SEC の会社一覧と名前で突き合わせ、残りを OpenFIGI に聞く
 * （OpenFIGI はキーなしだと 1 回 10 件・1 分 25 回まで）。complete=false は調べきれなかったもの
 */
async function tickers(rows: { cusip: string; name: string }[]): Promise<{ map: Record<string, string>; complete: boolean }> {
  const out: Record<string, string> = {};
  const names = await secNames().catch(() => ({}) as Record<string, string>);
  const left: string[] = [];
  for (const r of rows) {
    if (out[r.cusip]) continue;
    const hit = figiMemo.get(r.cusip) ?? names[norm(r.name)];
    if (hit) out[r.cusip] = hit;
    else left.push(r.cusip);
  }
  const list = [...new Set(left)];
  let complete = true;
  for (let i = 0; i < list.length; i += 10) {
    const part = list.slice(i, i + 10);
    const res = await fetch('https://api.openfigi.com/v3/mapping', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(part.map((c) => ({ idType: 'ID_CUSIP', idValue: c, exchCode: 'US' }))),
    });
    if (!res.ok) {
      complete = false; // 上限に達したら、残りはティッカーなしで表示し、少し後に取り直す
      break;
    }
    const found = (await res.json()) as { data?: { ticker?: string }[] }[];
    found.forEach((r, j) => {
      const t = r.data?.[0]?.ticker;
      if (t) {
        out[part[j]] = t.replace('/', '.');
        figiMemo.set(part[j], out[part[j]]);
      }
    });
  }
  return { map: out, complete };
}

const TOP = 100;

/** 有名ファンドの最新 13F（上位 100 銘柄）と前の期からの変化（3 日キャッシュ） */
export function fundHoldings(cik: string): Promise<FundHoldings> {
  const f = FUNDS.find((x) => x.cik === cik);
  if (!f) return Promise.reject(new Error('対象外のファンドです'));
  return cached(`13f:v1:${cik}`, 72 * HOUR, async () => {
    const filings = await latest13F(cik);
    if (!filings.length) throw new Error('13F の届け出がありません');
    const [now, prev] = filings;
    const cur = await infoTable(cik, now.accession);
    const old = prev ? await infoTable(cik, prev.accession) : [];
    const key = (r: Row) => `${r.cusip}|${r.putCall ?? ''}`;
    const oldBy = new Map(old.map((r) => [key(r), r]));
    const curKeys = new Set(cur.map(key));
    const total = cur.reduce((a, r) => a + r.value, 0);
    const totalPrev = old.reduce((a, r) => a + r.value, 0);

    const top = [...cur].sort((a, b) => b.value - a.value).slice(0, TOP);
    const sold = old.filter((r) => !curKeys.has(key(r))).sort((a, b) => b.value - a.value).slice(0, 20);
    const { map, complete } = await tickers([...top.slice(0, 60), ...sold.slice(0, 10)]);

    const pos = (r: Row, change: FundPosition['change'], prevShares: number | null): FundPosition => ({
      cusip: r.cusip,
      name: r.name,
      ticker: map[r.cusip] ?? null,
      cls: r.cls,
      putCall: r.putCall,
      value: r.value,
      shares: r.shares,
      prevShares,
      weight: change === 'sold' ? (totalPrev ? r.value / totalPrev : 0) : total ? r.value / total : 0,
      change,
    });
    const positions = top.map((r) => {
      const p = oldBy.get(key(r));
      if (!prev) return pos(r, 'same', null);
      if (!p) return pos(r, 'new', null);
      const diff = (r.shares - p.shares) / (p.shares || 1);
      return pos(r, diff > 0.005 ? 'add' : diff < -0.005 ? 'reduce' : 'same', p.shares);
    });
    return {
      ...f,
      reportDate: now.reportDate,
      filingDate: now.filingDate,
      prevReportDate: prev?.reportDate ?? null,
      totalValue: total,
      count: cur.length,
      positions,
      sold: sold.map((r) => pos(r, 'sold', r.shares)),
      complete,
    } satisfies FundHoldings;
  }, (v) => (v.complete ? 72 * HOUR : 20 * 60_000));
}

// ---------------------------------------------------------------- Yahoo（役員の売買・大口保有）

function kindOf(text: string): Ownership['insiders'][number]['kind'] {
  if (/^sale|sale at/i.test(text)) return 'sell';
  if (/purchase|buy/i.test(text)) return 'buy';
  if (/gift/i.test(text)) return 'gift';
  if (/award|grant/i.test(text)) return 'grant';
  if (/exercise|conversion/i.test(text)) return 'exercise';
  return 'other';
}

/** 役員の売買（Form 4）と、大口保有機関・ファンド（6 時間キャッシュ） */
export function ownership(symbol: string): Promise<Ownership> {
  return cached(`yf:own:${symbol}`, 6 * HOUR, async () => {
    const r = JSON.parse(
      JSON.stringify(
        await yahooRaw().quoteSummary(
          symbol.replace('.', '-'),
          { modules: ['insiderTransactions', 'institutionOwnership', 'fundOwnership', 'majorHoldersBreakdown'] },
          { validateResult: false },
        ),
      ),
    ) as {
      insiderTransactions?: { transactions?: Record<string, unknown>[] };
      institutionOwnership?: { ownershipList?: Record<string, unknown>[] };
      fundOwnership?: { ownershipList?: Record<string, unknown>[] };
      majorHoldersBreakdown?: Record<string, unknown>;
    };
    const holders = (list?: Record<string, unknown>[]) =>
      (list ?? []).slice(0, 10).map((h) => ({
        name: String(h.organization ?? ''),
        reportDate: day(h.reportDate),
        pctHeld: num(h.pctHeld),
        shares: num(h.position),
        value: num(h.value),
        pctChange: num(h.pctChange),
      }));
    const mh = r.majorHoldersBreakdown ?? {};
    return {
      symbol,
      insiders: (r.insiderTransactions?.transactions ?? []).slice(0, 30).map((t) => {
        const text = String(t.transactionText ?? '');
        return {
          date: day(t.startDate),
          name: String(t.filerName ?? ''),
          role: String(t.filerRelation ?? ''),
          text,
          kind: kindOf(text),
          shares: num(t.shares),
          value: num(t.value) || null,
        };
      }),
      institutions: holders(r.institutionOwnership?.ownershipList),
      funds: holders(r.fundOwnership?.ownershipList),
      insidersPct: num(mh.insidersPercentHeld),
      institutionsPct: num(mh.institutionsPercentHeld),
      institutionsCount: num(mh.institutionsCount),
    };
  });
}

// ---------------------------------------------------------------- FMP（議員の売買）

function toTrade(r: Record<string, unknown>, chamber: 'senate' | 'house'): CongressTrade {
  const first = String(r.firstName ?? '').trim();
  const last = String(r.lastName ?? '').trim();
  return {
    chamber,
    name: [first, last].filter(Boolean).join(' ') || String(r.office ?? r.representative ?? ''),
    symbol: String(r.symbol ?? '').toUpperCase(),
    asset: String(r.assetDescription ?? ''),
    type: String(r.type ?? ''),
    amount: String(r.amount ?? ''),
    owner: String(r.owner ?? ''),
    transactionDate: String(r.transactionDate ?? '').slice(0, 10) || null,
    disclosureDate: String(r.disclosureDate ?? '').slice(0, 10) || null,
    district: String(r.district ?? ''),
    link: /^https:\/\//.test(String(r.link ?? '')) ? String(r.link) : null,
  };
}

const sortTrades = (a: CongressTrade, b: CongressTrade) =>
  (b.disclosureDate ?? '').localeCompare(a.disclosureDate ?? '') || (b.transactionDate ?? '').localeCompare(a.transactionDate ?? '');

/** 議員の売買。symbol を渡すとその銘柄だけ、渡さなければ最新の報告（6 時間キャッシュ） */
export function congressTrades(symbol?: string): Promise<CongressTrade[]> {
  return cached(`fmp:congress:${symbol ?? 'latest'}`, 6 * HOUR, async () => {
    const params: Record<string, string> = symbol ? { symbol } : { page: '0', limit: '100' };
    const [s, h] = await Promise.all([
      fmp<Record<string, unknown>[]>(symbol ? 'senate-trades' : 'senate-latest', params),
      fmp<Record<string, unknown>[]>(symbol ? 'house-trades' : 'house-latest', params),
    ]);
    return [...(s ?? []).map((r) => toTrade(r, 'senate')), ...(h ?? []).map((r) => toTrade(r, 'house'))].sort(sortTrades).slice(0, 150);
  });
}
