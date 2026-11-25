// リアルタイム株価の中継（Finnhub の WebSocket）。
// Finnhub の無料キーは同時に 1 本しかつなげない（新しくつなぐと古い方が切られる）ので、
// 上流への接続はこのハブ 1 つだけにし、開いている画面すべてに配る。
//  - Cloudflare: Durable Object（server/worker.ts の PriceHubDO）の中で 1 つだけ動く
//  - 手元: server/node.ts の中で 1 つだけ動く
// キーはサーバーの中だけで使い、ブラウザには渡さない。

export interface HubClient {
  send(data: string): void;
  symbols: Set<string>;
}

const SYMBOL_RE = /^[A-Z]{1,5}([.-][A-Z]{1,2})?$/;
const MAX_SYMBOLS = 50; // Finnhub 無料プランの上限
const FLUSH_MS = 1000; // 約定は 1 秒ごとにまとめて送る
const IDLE_CLOSE_MS = 60_000; // 画面が全部閉じたら、少し待って上流も切る

type Tick = { p: number; v: number; t: number };

export class PriceHub {
  private clients = new Set<HubClient>();
  private upstream: WebSocket | null = null;
  private upstreamOpen = false;
  private subscribed = new Set<string>();
  private pending = new Map<string, Tick>();
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private retryMs = 2000;
  private lastError = '';

  constructor(private key: () => string | undefined) {}

  add(c: HubClient) {
    this.clients.add(c);
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = null;
    c.send(JSON.stringify(this.statusMsg()));
  }

  remove(c: HubClient) {
    this.clients.delete(c);
    this.sync();
    if (!this.clients.size && !this.idleTimer) {
      this.idleTimer = setTimeout(() => {
        this.idleTimer = null;
        if (!this.clients.size) this.closeUpstream();
      }, IDLE_CLOSE_MS);
    }
  }

  /** 画面から届いたメッセージ（{ type: 'sub', symbols: [...] }） */
  message(c: HubClient, raw: string) {
    let m: { type?: string; symbols?: unknown };
    try {
      m = JSON.parse(raw);
    } catch {
      return;
    }
    if (m.type === 'sub' && Array.isArray(m.symbols)) {
      c.symbols = new Set(
        m.symbols
          .map((s) => String(s).toUpperCase())
          .filter((s) => SYMBOL_RE.test(s))
          .slice(0, MAX_SYMBOLS),
      );
      this.sync();
    }
  }

  private statusMsg() {
    return { t: 's', status: !this.key() ? 'no-key' : this.upstreamOpen ? 'live' : this.lastError ? 'error' : 'connecting', error: this.lastError || undefined };
  }

  private broadcastStatus() {
    const msg = JSON.stringify(this.statusMsg());
    for (const c of this.clients) c.send(msg);
  }

  /** 画面が見たい銘柄の合計に合わせて、上流の購読を増やしたり減らしたりする */
  private sync() {
    const wanted = new Set<string>();
    for (const c of this.clients) for (const s of c.symbols) if (wanted.size < MAX_SYMBOLS) wanted.add(s);
    if (!wanted.size) {
      for (const s of this.subscribed) this.sendUp({ type: 'unsubscribe', symbol: s });
      this.subscribed.clear();
      return;
    }
    if (!this.upstream) {
      this.connect();
      return; // つながったら onopen で購読する
    }
    if (!this.upstreamOpen) return;
    for (const s of wanted) if (!this.subscribed.has(s)) this.sendUp({ type: 'subscribe', symbol: s });
    for (const s of this.subscribed) if (!wanted.has(s)) this.sendUp({ type: 'unsubscribe', symbol: s });
    this.subscribed = wanted;
  }

  private sendUp(m: object) {
    if (this.upstream && this.upstreamOpen) this.upstream.send(JSON.stringify(m));
  }

  private connect() {
    const key = this.key();
    if (!key || this.upstream || this.retryTimer) return;
    const ws = new WebSocket(`wss://ws.finnhub.io?token=${encodeURIComponent(key)}`);
    this.upstream = ws;
    ws.addEventListener('open', () => {
      this.upstreamOpen = true;
      this.lastError = '';
      this.retryMs = 2000;
      this.subscribed.clear();
      this.sync();
      this.broadcastStatus();
      if (!this.flushTimer) this.flushTimer = setInterval(() => this.flush(), FLUSH_MS);
    });
    ws.addEventListener('message', (e) => {
      let m: { type?: string; data?: { s: string; p: number; v: number; t: number }[]; msg?: string };
      try {
        m = JSON.parse(String(e.data));
      } catch {
        return;
      }
      if (m.type === 'trade' && m.data) {
        for (const d of m.data) {
          const cur = this.pending.get(d.s);
          // 1 秒の間の最後の約定の値段と、出来高の合計
          if (!cur || d.t >= cur.t) this.pending.set(d.s, { p: d.p, v: (cur?.v ?? 0) + d.v, t: d.t });
          else cur.v += d.v;
        }
      } else if (m.type === 'error') {
        this.lastError = String(m.msg ?? 'error');
      }
    });
    const down = () => {
      if (this.upstream !== ws) return;
      this.upstream = null;
      this.upstreamOpen = false;
      this.subscribed.clear();
      if (this.flushTimer) clearInterval(this.flushTimer);
      this.flushTimer = null;
      if (!this.lastError) this.lastError = 'disconnected';
      this.broadcastStatus();
      // 画面が開いている間は、間隔を広げながらつなぎ直す
      if (this.clients.size) {
        this.retryTimer = setTimeout(() => {
          this.retryTimer = null;
          this.sync();
        }, this.retryMs);
        this.retryMs = Math.min(this.retryMs * 2, 60_000);
      }
    };
    ws.addEventListener('close', down);
    ws.addEventListener('error', down);
  }

  private closeUpstream() {
    const ws = this.upstream;
    this.upstream = null;
    this.upstreamOpen = false;
    this.subscribed.clear();
    this.pending.clear();
    if (this.flushTimer) clearInterval(this.flushTimer);
    this.flushTimer = null;
    try {
      ws?.close();
    } catch {
      /* 無視 */
    }
  }

  /** たまった約定を、その銘柄を見ている画面にだけ送る。[銘柄, 値段, 出来高, 時刻(ms)] */
  private flush() {
    if (!this.pending.size) return;
    const ticks = [...this.pending.entries()];
    this.pending.clear();
    for (const c of this.clients) {
      const d = ticks.filter(([s]) => c.symbols.has(s)).map(([s, k]) => [s, k.p, k.v, k.t]);
      if (d.length) c.send(JSON.stringify({ t: 'p', d }));
    }
  }
}
