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
