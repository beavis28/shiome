// 銘柄ごとの SEC の届け出: 役員などの売却予定（Form 144）と 5% 以上の大量保有（Schedule 13D / 13G）
// 会社の届け出一覧には、その会社が「出した」届け出（他社株の 13G など）も混ざるので、発行体の CIK で絞る
import type { BigStake, Filings, Form144 } from '../src/types.ts';
import { cached, HOUR } from './cache.ts';
import { tx } from './lang.ts';
import { cikOf } from './lookup.ts';
import { sec } from './smart.ts';

const tag = (xml: string, name: string) => xml.match(new RegExp(`<(?:\\w+:)?${name}>([^<]*)<`, 'i'))?.[1].trim() ?? '';
const tags = (xml: string, name: string) => [...xml.matchAll(new RegExp(`<(?:\\w+:)?${name}>([^<]*)<`, 'gi'))].map((m) => m[1].trim());
const num = (s: string) => {
  const v = Number(s.replace(/[,$%\s]/g, ''));
  return s && Number.isFinite(v) ? v : null;
};
const decode = (s: string) => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&(apos|#39);/g, "'");
/** "11/19/2026" → "2026-11-19" */
const mdy = (s: string) => {
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  return m ? `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}` : null;
};

type Entry = { form: string; filed: string; accession: string };

async function primaryDoc(cik: string, accession: string) {
  return (await sec(`https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${accession.replace(/-/g, '')}/primary_doc.xml`)).text();
}
const indexUrl = (cik: string, accession: string) =>
  `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${accession.replace(/-/g, '')}/${accession}-index.htm`;

function parse144(xml: string, e: Entry, cik: string): Form144 | null {
  const out = num(tag(xml, 'noOfUnitsOutstanding'));
  const shares = num(tag(xml, 'noOfUnitsSold'));
  return {
    filed: e.filed,
    saleDate: mdy(tag(xml, 'approxSaleDate')),
    name: decode(tag(xml, 'nameOfPersonForWhoseAccountTheSecuritiesAreToBeSold')),
    role: tags(xml, 'relationshipToIssuer').join(', '),
    shares,
    value: num(tag(xml, 'aggregateMarketValue')),
    pctOut: shares && out ? shares / out : null,
    nature: decode(tag(xml, 'natureOfAcquisitionTransaction')),
    url: indexUrl(cik, e.accession),
  };
}

function parseStake(xml: string, e: Entry, cik: string): BigStake {
  // 共同で届け出る人が複数いるときは、名前をすべて集め、割合・株数は最大の値を使う
  const holders = [...new Set(tags(xml, 'reportingPersonName').map(decode))];
  const pcts = [...tags(xml, 'classPercent'), ...tags(xml, 'percentOfClass')].map(num).filter((v): v is number => v !== null && v <= 100);
  const shares = [...tags(xml, 'reportingPersonBeneficiallyOwnedAggregateNumberOfShares'), ...tags(xml, 'aggregateAmountOwned')]
    .map(num)
    .filter((v): v is number => v !== null);
  return {
    form: /13D/.test(e.form) ? '13D' : '13G',
    amendment: /\/A$/.test(e.form),
    filed: e.filed,
    eventDate: mdy(tag(xml, 'dateOfEvent') || tag(xml, 'eventDateRequiresFilingThisStatement')),
    holders,
    pct: pcts.length ? Math.max(...pcts) : null,
    shares: shares.length ? Math.max(...shares) : null,
    url: indexUrl(cik, e.accession),
  };
}

/** 発行体が一致するかを確かめる（13G の issuerCik / 13D の issuerCIK / 144 の issuerCik） */
const issuerIs = (xml: string, cik: string) => {
  const v = tag(xml, 'issuerCik') || tag(xml, 'issuerCIK');
  return !v || Number(v) === Number(cik);
};

/** 同時に送る数を抑えて順に処理する（SEC は 1 秒 10 回まで） */
async function mapLimit<T, R>(items: T[], limit: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  const worker = async () => {
    while (i < items.length) {
      const k = i++;
      out[k] = await fn(items[k]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

/** 銘柄の Form 144 と 13D / 13G（6 時間キャッシュ） */
export function filingsFor(symbol: string): Promise<Filings> {
  return cached(`sec:filings:v1:${symbol}`, 6 * HOUR, async () => {
    const cik = await cikOf(symbol);
    if (!cik) throw new Error(tx('SEC の会社一覧に見つかりません（ETF などは対象外）', 'Not in the SEC company list (ETFs are not covered)'));
    const d = (await (await sec(`https://data.sec.gov/submissions/CIK${cik}.json`)).json()) as {
      filings: { recent: { form: string[]; filingDate: string[]; accessionNumber: string[] } };
    };
    const r = d.filings.recent;
    const since144 = new Date(Date.now() - 365 * 86400_000).toISOString().slice(0, 10);
    const sinceStake = new Date(Date.now() - 2 * 365 * 86400_000).toISOString().slice(0, 10);
    const f144: Entry[] = [];
    const stakes: Entry[] = [];
    for (let i = 0; i < r.form.length; i++) {
      const e = { form: r.form[i], filed: r.filingDate[i], accession: r.accessionNumber[i] };
      // 2024 年 12 月から 13D / 13G は XML（SCHEDULE 13D / 13G）になった。それより前の文書形式は読まない
      if (e.form === '144' && e.filed >= since144 && f144.length < 15) f144.push(e);
      else if (/^SCHEDULE 13[DG](\/A)?$/.test(e.form) && e.filed >= sinceStake && stakes.length < 12) stakes.push(e);
    }
    const docs = await mapLimit([...f144, ...stakes], 5, async (e) => ({ e, xml: await primaryDoc(cik, e.accession).catch(() => '') }));
    const form144: Form144[] = [];
    const big: BigStake[] = [];
    for (const { e, xml } of docs) {
      if (!xml || !issuerIs(xml, cik)) continue;
      if (e.form === '144') {
        const p = parse144(xml, e, cik);
        if (p) form144.push(p);
      } else big.push(parseStake(xml, e, cik));
    }
    // 同じ保有者の届け出は最新のものだけ残す
    const seen = new Set<string>();
    const latestStakes = big.filter((s) => {
      const k = s.holders[0] ?? s.url;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
    return { symbol, form144, stakes: latestStakes };
  });
}
