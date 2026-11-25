// FRED（米セントルイス連銀）への問い合わせ。
// FRED の手前の配信網は、User-Agent がない（Workers の既定）・"node"・ブラウザ風の要求に応答せず、
// 接続をつないだまま止めてしまう。アプリ名と連絡先の URL を入れた User-Agent を付け、時間切れも設ける
export const fredFetch = (url: string) =>
  fetch(url, {
    headers: { 'User-Agent': 'Shiome (github.com/beavis28/shiome)', Accept: 'application/json' },
    signal: AbortSignal.timeout(10_000),
  });
