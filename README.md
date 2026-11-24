<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="brand/shiome-logo-dark.png">
    <img src="brand/shiome-logo-light.png" alt="Shiome" height="72">
  </picture>
</p>

<p align="center">
  A one-screen US stock dashboard: watchlist, analyst targets, technicals, earnings dates, the economic calendar, news and an AI explainer, side by side.<br>
  米国株のウォッチリストを、目標価格・テクニカル・決算日・経済指標・ニュースと一緒に 1 画面で見るダッシュボード。
</p>

<p align="center"><a href="#日本語">日本語</a> · <a href="#english">English</a></p>

![Shiome screenshot](docs/screenshot.png)

> [!WARNING]
> **For information only. Not investment advice.** Prices can be delayed or wrong. Shiome does not recommend buying or selling anything.
> 情報提供のみを目的としたツールです。投資助言や売買の推奨ではありません。

---

## English

*Shiome* (潮目) is the line where two ocean currents meet — the place where the tide turns. The app helps you notice when the market's current changes.

### Features

- **Import tickers from a photo** — drop a screenshot of your brokerage app or watchlist. Tickers are read by Claude (if `ANTHROPIC_API_KEY` is set) or by Tesseract.js in the browser, then you review and fix them before adding.
- **Compare your watchlist** — price, change, upside to the analyst mean target, RSI and MACD direction, and days until earnings. Sort by any column.
- **One-screen detail view**
  - Real-time / delayed price (labelled), pre-market and after-hours price
  - Analyst targets: mean, median, high, low and the gap to the current price
  - Candlestick chart with SMA 20/50/200, Bollinger Bands, RSI and MACD
  - Badges for overbought/oversold RSI, MACD crosses, Bollinger position and trend
  - Next earnings date
- **Economic calendar** — CPI, jobs report, PCE, GDP, PPI, retail sales (from FRED) and FOMC decisions, shown in your local time together with your watchlist's earnings dates.
- **News** for the selected stock.
- **Ask about the screen** — a chat panel sends what you are looking at to Claude, which explains the data. It is instructed never to give buy/sell recommendations, price targets or personal advice.
- **Auto refresh** — every 20 seconds while the US market (including pre/post) is open, every 5 minutes otherwise.

### Quick start

```bash
npm install
cp .env.example .env      # add your own keys (all optional)
npm run dev               # API on :8787, web on :5180
```

Open <http://localhost:5180>. With no keys at all, Shiome still works using Yahoo Finance data.

| Variable | Used for | Without it |
| --- | --- | --- |
| `FMP_API_KEY` | [Financial Modeling Prep](https://site.financialmodelingprep.com/developer/docs): daily prices, analyst targets, earnings dates, ticker validation | Yahoo Finance is used |
| `FRED_API_KEY` | [FRED](https://fred.stlouisfed.org/docs/api/api_key.html): release dates of economic indicators | Only FOMC dates are shown |
| `ANTHROPIC_API_KEY` | [Claude](https://console.anthropic.com): reading tickers from images, the chat panel | Tesseract.js OCR; chat is off |

Keys are read only by the server and never sent to the browser. `DEMO=1` shows made-up demo data without any network calls.

### Deploy to Cloudflare Workers

The web app is served as static assets and the API runs in the same Worker. **The API only answers requests that passed [Cloudflare Access](https://developers.cloudflare.com/cloudflare-one/policies/access/)**; until Access is configured it returns an error, so your keys are never exposed.

```bash
npx wrangler login
npm run deploy                          # creates the KV namespace on first deploy
npx wrangler secret put FMP_API_KEY     # repeat for FRED_API_KEY / ANTHROPIC_API_KEY
```

Then, in the Cloudflare dashboard:

1. Workers & Pages → your Worker → **Access** → protect **all traffic** (production and previews).
2. Zero Trust → Access → Applications → your app → **Policies**: allow a list of **Emails**. **Login methods**: enable **One-time PIN** (users get a code by email; no Cloudflare account needed).
3. Copy the **AUD tag** and the **team domain** (`https://<team>.cloudflareaccess.com`), put them in `vars` of `wrangler.local.jsonc` (a git-ignored copy of `wrangler.jsonc` for your own account, used automatically by `npm run deploy`), and deploy again.

### Data sources and refresh

| Data | Source (first wins) | Refresh |
| --- | --- | --- |
| Current price, change, extended hours | Yahoo → FMP | 20 s while the market is open, otherwise 5 min |
| Daily candles | FMP → Yahoo | 6 h cache; today's candle follows the live price |
| Analyst targets, next earnings | FMP → Yahoo | 12 h cache |
| News | Yahoo | 5 min |
| Economic calendar | FRED + FOMC schedule in `server/econ.ts` | 12 h cache |

Yahoo Finance data is fetched with the unofficial [`yahoo-finance2`](https://github.com/gadicc/yahoo-finance2) library. It may break without notice, and Yahoo's terms limit it to personal use — do not use Shiome to redistribute Yahoo data or run it as a public service.

### Project layout

```
server/   API (Hono). app.ts = routes; node.ts = local entry; worker.ts = Cloudflare entry
          fmp.ts / yahoo.ts / econ.ts = data sources, chat.ts = Claude chat, access.ts = Access JWT check
src/      React + Tailwind UI. lib/indicators.ts = SMA / RSI / MACD / Bollinger Bands
brand/    Logo files
```

The FOMC schedule in `server/econ.ts` is maintained by hand — update it when the Federal Reserve publishes or changes its calendar.

---

## 日本語

**潮目**は、性質の違う 2 つの潮の流れがぶつかる境目のことです。相場の流れが変わる瞬間に気づくための道具、という意味を込めています。

### できること

- **写真から銘柄を取り込む** — 証券アプリやウォッチリストのスクリーンショットから、ティッカーを読み取ります（Claude またはブラウザ内 OCR）。追加する前に確認・修正できます。
- **ウォッチリストの比較** — 現在値・前日比・目標価格との乖離率・RSI・MACD の向き・決算までの日数を一覧で。列ごとに並べ替えできます。
- **1 画面の詳細** — リアルタイム／遅延の表示付きの現在値とプレ・アフターマーケットの価格、アナリスト目標価格（平均・中央値・高値・安値）、ローソク足チャート（SMA 20/50/200・ボリンジャーバンド・RSI・MACD）、テクニカルのバッジ、次回決算日。
- **経済指標カレンダー** — CPI・雇用統計・PCE・GDP・PPI・小売売上高（FRED）と FOMC を、閲覧している場所の時刻で表示。ウォッチリストの決算日もまとめて並べます。
- **ニュース** — 選んだ銘柄の最新ニュース。
- **相場の相談** — 表示中のデータを Claude に渡して解説させます。売買の推奨や個別の投資助言はしないよう指示しています。
- **自動更新** — 米国市場の取引時間中（プレ・アフター含む）は 20 秒ごと、それ以外は 5 分ごと。

### はじめ方

```bash
npm install
cp .env.example .env      # キーを自分で記入（すべて任意）
npm run dev               # API（:8787）と画面（:5180）を起動
```

<http://localhost:5180> を開きます。キーがなくても Yahoo Finance のデータで動きます。キーの用途は上の表（English）のとおりです。キーはサーバー側だけで使い、ブラウザには送りません。

### Cloudflare Workers へのデプロイ

画面と API を 1 つの Worker で動かします。**API は Cloudflare Access でログインした人にしか応答しません**（Access を設定するまではエラーを返すので、キーが外に出ることはありません）。

```bash
npx wrangler login
npm run deploy                          # 初回は KV が自動で作られます
npx wrangler secret put FMP_API_KEY     # FRED_API_KEY / ANTHROPIC_API_KEY も同様
```

そのあと Cloudflare のダッシュボードで:

1. Workers & Pages → Worker → **Access** で、すべてのトラフィック（本番とプレビュー）を保護する
2. Zero Trust → Access → Applications → アプリ → **Policies** で、許可する **Emails** を並べる。**Login methods** は **One-time PIN**（メールに届くコードでログイン。Cloudflare アカウントは不要）
3. **AUD タグ**と **Team domain**（`https://〇〇.cloudflareaccess.com`）を、`wrangler.local.jsonc`（自分のアカウント用に `wrangler.jsonc` をコピーしたファイル。git には含めず、`npm run deploy` が自動で使う）の `vars` に入れて再デプロイ

### 注意

- Yahoo Finance のデータは非公式ライブラリ `yahoo-finance2` で取得しています。仕様変更で突然取れなくなることがあります。Yahoo の規約上、**個人利用に限り**、データの再配布や公開サービスでの利用はしないでください。
- FOMC の日程は `server/econ.ts` に手で書いています。FRB が日程を公表・変更したら更新してください。

## License

[MIT](LICENSE) © 2026 ENGINEERNEST
