// ヒートマップ用の「主要米国株」リスト（時価総額上位の約 120 銘柄、手動で管理）。
// 業界は Yahoo Finance のセクター分類に合わせている。構成は年に一度くらい見直す。
export const SECTOR_JA: Record<string, string> = {
  Technology: '情報技術',
  'Communication Services': '通信・メディア',
  'Consumer Cyclical': '一般消費財',
  'Consumer Defensive': '生活必需品',
  Healthcare: 'ヘルスケア',
  'Financial Services': '金融',
  Industrials: '資本財',
  Energy: 'エネルギー',
  'Basic Materials': '素材',
  Utilities: '公益',
  'Real Estate': '不動産',
};

const LIST: Record<string, string[]> = {
  Technology: ['AAPL', 'MSFT', 'NVDA', 'AVGO', 'ORCL', 'CRM', 'AMD', 'ADBE', 'CSCO', 'ACN', 'IBM', 'QCOM', 'TXN', 'INTU', 'NOW', 'AMAT', 'MU', 'LRCX', 'KLAC', 'ADI', 'PANW', 'ANET', 'PLTR', 'SNPS', 'CDNS', 'CRWD', 'INTC', 'APH', 'MSI'],
  'Communication Services': ['GOOGL', 'META', 'NFLX', 'TMUS', 'DIS', 'VZ', 'T', 'CMCSA'],
  'Consumer Cyclical': ['AMZN', 'TSLA', 'HD', 'MCD', 'LOW', 'BKNG', 'TJX', 'NKE', 'SBUX', 'ABNB', 'CMG', 'ORLY'],
  'Consumer Defensive': ['WMT', 'COST', 'PG', 'KO', 'PEP', 'PM', 'MDLZ', 'MO', 'CL'],
  Healthcare: ['LLY', 'UNH', 'JNJ', 'ABBV', 'MRK', 'TMO', 'ABT', 'ISRG', 'AMGN', 'DHR', 'PFE', 'BSX', 'SYK', 'GILD', 'VRTX', 'MDT'],
  'Financial Services': ['BRK.B', 'JPM', 'V', 'MA', 'BAC', 'WFC', 'GS', 'MS', 'AXP', 'BLK', 'SCHW', 'C', 'SPGI', 'PGR', 'CB', 'COF'],
  Industrials: ['GE', 'CAT', 'RTX', 'HON', 'UNP', 'BA', 'DE', 'LMT', 'ETN', 'UPS', 'ADP', 'GEV'],
  Energy: ['XOM', 'CVX', 'COP', 'EOG', 'SLB'],
  'Basic Materials': ['LIN', 'SHW', 'APD', 'FCX'],
  Utilities: ['NEE', 'SO', 'DUK', 'CEG'],
  'Real Estate': ['PLD', 'AMT', 'EQIX', 'WELL'],
};

/** 銘柄 → セクター（英語のキー） */
export const MAJOR_SECTOR: Record<string, string> = Object.fromEntries(
  Object.entries(LIST).flatMap(([sector, syms]) => syms.map((s) => [s, sector])),
);

export const MAJOR_SYMBOLS = Object.keys(MAJOR_SECTOR);
