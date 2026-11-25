// サーバーから日本語で届く名前（指標・市場・業界・投資家など）の英語版。
// サーバーのキャッシュは言語ごとに分けず、画面側で ID から英語名に置き換える
import { getLang, type Lang } from './i18n';
import type { EconEvent, Indicator, MacroGroup, MacroItem, Quote } from '../types';

const MACRO: Record<string, [string, string?]> = {
  '^GSPC': ['S&P 500'],
  '^IXIC': ['Nasdaq Composite'],
  '^DJI': ['Dow Jones'],
  '^RUT': ['Russell 2000', 'US small caps'],
  '^VIX': ['VIX', 'Fear gauge. Above 20 is usually read as elevated anxiety'],
  '^N225': ['Nikkei 225'],
  '^HSI': ['Hang Seng'],
  '000001.SS': ['Shanghai Composite'],
  '^KS11': ['KOSPI (Korea)'],
  '^TWII': ['TAIEX (Taiwan)', 'Heavily weighted to semiconductors (TSMC)'],
  '^BSESN': ['SENSEX (India)'],
  '^GDAXI': ['DAX (Germany)'],
  '^STOXX50E': ['Euro Stoxx 50'],
  '^FTSE': ['FTSE 100 (UK)'],
  '^IRX': ['US 3M'],
  '^FVX': ['US 5Y'],
  '^TNX': ['US 10Y', 'Long-term rate that drives mortgages and equity valuations'],
  '^TYX': ['US 30Y'],
  'CL=F': ['WTI crude', 'Futures, USD per barrel'],
  'BZ=F': ['Brent crude', 'Futures, USD per barrel'],
  'NG=F': ['Natural gas', 'Futures, USD per MMBtu'],
  'GC=F': ['Gold', 'Futures, USD per troy ounce'],
  'SI=F': ['Silver', 'Futures, USD per troy ounce'],
  'HG=F': ['Copper', 'Futures, USD per pound. Often seen as a leading indicator of the economy'],
  'DX-Y.NYB': ['Dollar index', 'Dollar strength against six major currencies'],
  'USDJPY=X': ['USD/JPY'],
  'EURUSD=X': ['EUR/USD'],
  'USDCNY=X': ['USD/CNY'],
  'BTC-USD': ['Bitcoin'],
  'ETH-USD': ['Ethereum'],
  DFF: ['Fed funds (effective)', 'Where the Fed policy rate actually trades (FRED, previous business day)'],
  DGS2: ['US 2Y', 'Tends to reflect the expected path of the policy rate (FRED, previous business day)'],
  T10Y2Y: ['10Y − 2Y', 'A negative spread (inverted curve) is often read as a recession warning (FRED)'],
};

const GROUPS: Record<string, string> = {
  index: 'US indices',
  world: 'World indices',
  rates: 'US rates',
  commodities: 'Commodities',
  fx: 'Currencies',
  crypto: 'Crypto',
};

const INDICATORS: Record<string, [string, string?]> = {
  CPIAUCSL: ['CPI (YoY)', 'Consumer prices, the headline inflation gauge'],
  CPILFESL: ['Core CPI (YoY)', 'CPI excluding food and energy'],
  PCEPILFE: ['Core PCE (YoY)', 'The gauge the Fed uses for its 2% inflation target'],
  T10YIE: ['10Y inflation expectations', 'Average inflation the market expects over the next 10 years (breakeven)'],
  UNRATE: ['Unemployment rate'],
  PAYEMS: ['Nonfarm payrolls (change)', 'Monthly change in jobs (thousands)'],
  ICSA: ['Initial jobless claims', 'Released every Thursday. Rising claims point to a weaker job market'],
  A191RL1Q225SBEA: ['Real GDP growth (annualized)', 'Quarter on quarter, annualized'],
  RSAFS: ['Retail sales (MoM)'],
  UMCSENT: ['Michigan consumer sentiment', 'How consumers see the economy. Higher means more optimistic'],
};

const ECON: Record<string, string> = {
  CPI: 'CPI (consumer prices)',
  NFP: 'Jobs report',
  PCE: 'PCE (personal income & spending)',
  GDP: 'GDP',
  PPI: 'PPI (producer prices)',
  RETAIL: 'Retail sales',
  FOMC: 'FOMC rate decision',
};

/** 業界（日本語 → 英語） */
const SECTOR: Record<string, string> = {
  情報技術: 'Technology',
  '通信・メディア': 'Communication',
  一般消費財: 'Consumer Cyclical',
  生活必需品: 'Consumer Defensive',
  ヘルスケア: 'Healthcare',
  金融: 'Financials',
  資本財: 'Industrials',
  エネルギー: 'Energy',
  素材: 'Materials',
  公益: 'Utilities',
  不動産: 'Real Estate',
  その他: 'Other',
};

/** 有名投資家（CIK → 英語名） */
const MANAGER: Record<string, string> = {
  '0001067983': 'Warren Buffett',
  '0001336528': 'Bill Ackman',
  '0001536411': 'Stanley Druckenmiller',
  '0001656456': 'David Tepper',
  '0001697748': 'Cathie Wood',
  '0001061768': 'Seth Klarman',
  '0001709323': 'Li Lu',
  '0000921669': 'Carl Icahn',
  '0001040273': 'Dan Loeb',
  '0001167483': 'Chase Coleman',
  '0001029160': 'George Soros',
  '0001350694': 'Ray Dalio (founder)',
};

const en = (lang?: Lang) => (lang ?? getLang()) === 'en';

export const macroLabel = (i: Pick<MacroItem, 'id' | 'label'>, lang?: Lang) => (en(lang) ? (MACRO[i.id]?.[0] ?? i.label) : i.label);
export const macroNote = (i: Pick<MacroItem, 'id' | 'note'>, lang?: Lang) => (en(lang) ? (MACRO[i.id] ? MACRO[i.id][1] : i.note) : i.note);
export const groupLabel = (g: Pick<MacroGroup, 'key' | 'label'>, lang?: Lang) => (en(lang) ? (GROUPS[g.key] ?? g.label) : g.label);
export const indicatorLabel = (i: Pick<Indicator, 'id' | 'label'>, lang?: Lang) => (en(lang) ? (INDICATORS[i.id]?.[0] ?? i.label) : i.label);
export const indicatorNote = (i: Pick<Indicator, 'id' | 'note'>, lang?: Lang) => (en(lang) ? (INDICATORS[i.id] ? INDICATORS[i.id][1] : i.note) : i.note);
export const econLabel = (e: Pick<EconEvent, 'key' | 'label'>, lang?: Lang) => (en(lang) ? (ECON[e.key] ?? e.label) : e.label);
export function econDetail(e: Pick<EconEvent, 'detail'>, lang?: Lang) {
  if (!e.detail || !en(lang)) return e.detail;
  const m = e.detail.match(/会合\s*(\S+)〜(\S+)/);
  if (m) return `Meeting ${m[1]} to ${m[2]}`;
  if (/戦略討議/.test(e.detail)) return 'Strategy review only (no policy decision)';
  return e.detail;
}
export const sectorLabel = (s: string, lang?: Lang) => (en(lang) ? (SECTOR[s] ?? s) : s);
export const managerName = (f: { cik: string; manager: string }, lang?: Lang) => (en(lang) ? (MANAGER[f.cik] ?? f.manager) : f.manager);

/** 価格の配信元（「リアルタイム（Nasdaq）」「15分遅延」）とプレ・アフター */
export function feedLabel(q: Pick<Quote, 'feed'>, lang?: Lang) {
  if (!q.feed || !en(lang)) return q.feed ?? null;
  const rt = q.feed.match(/^リアルタイム（(.*)）$/);
  if (rt) return `Real-time (${rt[1]})`;
  const d = q.feed.match(/^(\d+)分遅延$/);
  if (d) return `${d[1]}-min delay`;
  return q.feed;
}
export const extLabel = (q: Pick<Quote, 'extLabel'>, lang?: Lang) =>
  !q.extLabel || !en(lang) ? (q.extLabel ?? null) : q.extLabel === 'プレ' ? 'Pre-market' : q.extLabel === 'アフター' ? 'After hours' : q.extLabel;
