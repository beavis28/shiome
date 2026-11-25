// サーバーとフロントで共有する型

export interface Bar {
  time: string; // YYYY-MM-DD
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface Quote {
  symbol: string;
  name: string;
  price: number;
  change: number;
  changePercent: number;
  previousClose: number;
  dayLow: number;
  dayHigh: number;
  yearLow: number;
  yearHigh: number;
  marketCap: number | null;
  volume: number | null;
  exchange: string;
  time?: string | null; // 価格の時刻（ISO）
  marketState?: string | null; // PRE / REGULAR / POST / CLOSED など
  feed?: string | null; // 「リアルタイム（Nasdaq）」「15分遅延」など
  realtime?: boolean;
  extPrice?: number | null; // 時間外の価格
  extChangePercent?: number | null;
  extLabel?: string | null; // プレ / アフター
}

export interface PriceTarget {
  mean: number | null; // コンセンサス（平均）
  median: number | null;
  high: number | null;
  low: number | null;
  analysts?: number | null;
}

export interface Earnings {
  date: string | null; // 次回決算日 YYYY-MM-DD
  epsEstimated: number | null;
  revenueEstimated: number | null;
  lastDate: string | null; // 直近の発表日
  estimate?: boolean; // 日付が会社未確定の推定か
}

export type DataSource = 'FMP' | 'Yahoo' | 'demo';

export interface Section<T> {
  data: T | null;
  error: string | null;
  source?: DataSource;
}

export interface StockPayload {
  symbol: string;
  demo: boolean;
  fetchedAt: string;
  quote: Section<Quote>;
  history: Section<Bar[]>;
  target: Section<PriceTarget>;
  earnings: Section<Earnings>;
}

export interface EconEvent {
  date: string; // YYYY-MM-DD
  timeET: string; // "08:30"
  key: string; // CPI, NFP, ...
  label: string; // 表示名（日本語）
  detail?: string;
  importance: 'high' | 'medium';
  source: 'FRED' | 'FOMC';
}

export interface EconPayload {
  events: EconEvent[];
  warnings: string[];
}

export interface NewsItem {
  id: string;
  title: string;
  publisher: string;
  link: string;
  time: string; // ISO
  related: string[];
  thumbnail: string | null;
}

export interface AppConfig {
  yahoo: boolean;
  demo: boolean;
  fmp: boolean;
  fred: boolean;
  anthropic: boolean;
  exa?: boolean;
  tavily?: boolean;
  sec?: boolean;
}

export interface OcrTicker {
  symbol: string;
  name?: string | null;
  confidence?: 'high' | 'medium' | 'low';
}

/** 銘柄比較用の指標（比率は 0.12 = 12% の形） */
export interface Valuation {
  symbol: string;
  name: string | null;
  marketCap: number | null;
  trailingPE: number | null;
  forwardPE: number | null;
  psr: number | null;
  pbr: number | null;
  evToEbitda: number | null;
  peg: number | null;
  dividendYield: number | null;
  revenueGrowth: number | null;
  profitMargin: number | null;
  operatingMargin: number | null;
  roe: number | null;
  beta: number | null;
  source: DataSource;
}

export interface ValuationPayload {
  data: Record<string, Valuation>;
  errors: Record<string, string>;
}

/** ヒートマップの 1 銘柄（変化率は % 単位: 1.5 = +1.5%） */
export interface HeatItem {
  symbol: string;
  name: string;
  sector: string; // 日本語のセクター名
  marketCap: number;
  price: number;
  change1d: number | null;
  vs50d: number | null;
  change52w: number | null;
}

export interface HeatmapPayload {
  items: HeatItem[];
  missing: string[];
  asOf: string;
}

/** 金利・商品・為替などの 1 項目 */
export interface MacroItem {
  id: string;
  label: string;
  value: number | null;
  change: number | null; // 前日比（金利は %pt）
  changePct: number | null;
  unit: 'pt' | 'yield' | 'usd' | 'fx' | 'index';
  decimals: number;
  spark: [string, number][]; // 約 3 か月の日足終値
  asOf: string | null;
  source: 'Yahoo' | 'FRED';
  note?: string;
  state?: string | null; // 市場の状態（REGULAR など）
}

/** 米国の経済指標（最新の発表値） */
export interface Indicator {
  id: string;
  label: string;
  value: number | null;
  prev: number | null;
  unit: '%' | 'k' | 'num';
  decimals: number;
  date: string | null; // 対象期間の開始日（月次なら 2026-09-01）
  freq: 'M' | 'Q' | 'W' | 'D';
  spark: [string, number][];
  nextKey?: string; // 経済指標カレンダーの key（CPI など）
  note?: string;
}

export interface MacroGroup {
  key: string;
  label: string;
  items: MacroItem[];
}

export interface MacroPayload {
  groups: MacroGroup[];
  indicators: Indicator[];
  warnings: string[];
  asOf: string;
}

/** 相談チャットで表示するグラフ（Chart.js / three.js で描画） */
export type ChartKind = 'bar' | 'hbar' | 'line' | 'area' | 'doughnut' | 'scatter' | 'bubble' | 'radar' | 'scatter3d';
export interface ChartPoint {
  label: string;
  x: number;
  y: number;
  z?: number;
  r?: number; // bubble の大きさ（元の値。描画時に半径へ変換）
  group?: string;
}
export interface ChartSpec {
  kind: ChartKind;
  title: string;
  unit: string;
  labels?: string[];
  series?: { name: string; values: (number | null)[] }[];
  points?: ChartPoint[];
  xTitle?: string;
  yTitle?: string;
  zTitle?: string;
  source?: string;
}

/** 端末をまたいで同期する設定（ログインしているメールアドレスごと） */
export interface Prefs {
  watchlist: string[];
  compareSymbols: string[];
  compareMetrics: string[];
  updatedAt: number; // ミリ秒
}

/** 有名投資家（13F を出すファンド） */
export interface FundSummary {
  cik: string;
  fund: string;
  manager: string;
}

export interface FundPosition {
  cusip: string;
  name: string; // 13F に書かれた発行体名（略称）
  ticker: string | null;
  cls: string;
  putCall: string | null; // Put / Call（オプション）なら入る
  value: number; // ドル
  shares: number;
  prevShares: number | null;
  weight: number; // 0.12 = 12%
  change: 'new' | 'add' | 'reduce' | 'same' | 'sold';
}

export interface FundHoldings extends FundSummary {
  reportDate: string; // 対象の四半期末
  filingDate: string; // 届け出日
  prevReportDate: string | null;
  totalValue: number;
  count: number;
  positions: FundPosition[]; // 上位 100
  sold: FundPosition[]; // 前の期から全部売った銘柄
  complete?: boolean; // ティッカーを調べきれたか
}

export interface Holder {
  name: string;
  reportDate: string | null;
  pctHeld: number | null;
  shares: number | null;
  value: number | null;
  pctChange: number | null;
}

/** 役員の売買と大口保有者（Yahoo Finance） */
export interface Ownership {
  symbol: string;
  insiders: {
    date: string | null;
    name: string;
    role: string;
    text: string;
    kind: 'buy' | 'sell' | 'gift' | 'grant' | 'exercise' | 'other';
    shares: number | null;
    value: number | null;
  }[];
  institutions: Holder[];
  funds: Holder[];
  insidersPct: number | null;
  institutionsPct: number | null;
  institutionsCount: number | null;
}

/** 議員の売買（STOCK Act の報告） */
export interface CongressTrade {
  chamber: 'senate' | 'house';
  name: string;
  symbol: string;
  asset: string;
  type: string; // Purchase / Sale (Full) / Sale (Partial) / Exchange
  amount: string; // "$1,001 - $15,000" のような幅
  owner: string; // 本人 / 配偶者 など
  transactionDate: string | null;
  disclosureDate: string | null;
  district: string;
  link: string | null;
}
