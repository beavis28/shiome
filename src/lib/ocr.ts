// 画像の前処理と、ブラウザ内 OCR（Tesseract.js）によるティッカー候補の抽出
import type { OcrTicker } from '../types';

/** 長辺を maxSide 以下に縮小して JPEG の base64 にする（送信量とトークンを節約） */
export async function resizeImage(file: Blob, maxSide = 1568): Promise<{ data: string; mediaType: string; url: string }> {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bmp.width * scale);
  canvas.height = Math.round(bmp.height * scale);
  canvas.getContext('2d')!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  const url = canvas.toDataURL('image/jpeg', 0.9);
  return { data: url.split(',')[1], mediaType: 'image/jpeg', url };
}

// 画面上によく出るがティッカーではない語
const STOP = new Set(
  `A I AM PM US USA USD JPY EUR ETF ETFS NYSE NASDAQ AMEX OTC DOW SP SPX NDX IXIC VIX THE AND FOR YOU ALL NEW BUY SELL HOLD
  OPEN CLOSE HIGH LOW VOL AVG MKT CAP PE EPS DIV YTD TTM QTD MTD DAY WK MO YR MAX MIN LAST CHG PCT NET GAIN LOSS TOTAL
  CASH LIMIT STOP MARKET ORDER ORDERS TRADE TRADES QTY BID ASK SIZE INC CORP LTD CO PLC LLC LP ADR SPDR TR FUND INDEX
  OK NO YES ON OFF IN OUT TO OF AT BY OR IS IT AS BE UP DN LIVE EST ET JST GMT UTC AH PRE POST EXT HOME MENU EDIT DONE
  WATCHLIST LIST NEWS CHART INFO MORE ADD TAP SEE VIEW SORT FILTER SEARCH ACCOUNT BALANCE PORTFOLIO RETURN RETURNS
  APP IOS LTE WIFI GB MB KB AI TV PDF`.split(/\s+/),
);

export async function readTickersWithTesseract(
  images: Blob[],
  onProgress?: (p: number) => void,
): Promise<OcrTicker[]> {
  const { createWorker } = await import('tesseract.js');
  const worker = await createWorker('eng', 1, {
    logger: (m: { status: string; progress: number }) => {
      if (m.status === 'recognizing text') onProgress?.(m.progress);
    },
  });
  const counts = new Map<string, number>();
  try {
    for (const img of images) {
      const { data } = await worker.recognize(img);
      for (const raw of data.text.match(/\$?\b[A-Z]{1,5}(?:[.-][A-Z]{1,2})?\b/g) ?? []) {
        const s = raw.replace('$', '');
        if (STOP.has(s) || (s.length === 1 && !raw.startsWith('$'))) continue;
        counts.set(s, (counts.get(s) ?? 0) + 1);
      }
    }
  } finally {
    await worker.terminate();
  }
  return [...counts.keys()].map((symbol) => ({ symbol, name: null, confidence: 'low' as const }));
}
