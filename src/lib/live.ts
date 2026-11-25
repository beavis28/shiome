// リアルタイム株価の受信（サーバーの /api/stream に WebSocket でつなぐ。キーはサーバー側にしかない）
// 画面が見えている間だけつなぎ、切れたら間隔を広げながらつなぎ直す
import { useEffect, useRef, useState } from 'react';

export type LiveStatus = 'off' | 'connecting' | 'live' | 'no-key' | 'error';
/** [銘柄, 値段, 出来高, 時刻(ms)] */
export type Tick = [string, number, number, number];

export function useLiveStream(symbols: string[], enabled: boolean, onTicks: (t: Tick[]) => void) {
  const [status, setStatus] = useState<LiveStatus>('off');
  const [lastTick, setLastTick] = useState<number | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const symsRef = useRef(symbols);
  const cbRef = useRef(onTicks);
  cbRef.current = onTicks;
  symsRef.current = symbols;

  const key = [...symbols].sort().join(',');
  // 見る銘柄が変わったら購読し直す
  useEffect(() => {
    const ws = wsRef.current;
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'sub', symbols: symsRef.current }));
  }, [key]);

  useEffect(() => {
    if (!enabled) {
      setStatus('off');
      return;
    }
    let stopped = false;
    let retry = 2000;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const open = () => {
      if (stopped || document.hidden || wsRef.current) return;
      const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/api/stream`);
      wsRef.current = ws;
      setStatus('connecting');
      ws.onopen = () => {
        retry = 2000;
        ws.send(JSON.stringify({ type: 'sub', symbols: symsRef.current }));
      };
      ws.onmessage = (e) => {
        let m: { t?: string; status?: LiveStatus; d?: Tick[] };
        try {
          m = JSON.parse(String(e.data));
        } catch {
          return;
        }
        if (m.t === 's' && m.status) setStatus(m.status);
        else if (m.t === 'p' && m.d?.length) {
          setLastTick(Date.now());
          cbRef.current(m.d);
        }
      };
      ws.onclose = () => {
        if (wsRef.current === ws) wsRef.current = null;
        if (stopped) return;
        setStatus((s) => (s === 'no-key' ? s : 'error'));
        if (!document.hidden) timer = setTimeout(open, retry);
        retry = Math.min(retry * 2, 60_000);
      };
    };
    const close = () => {
      wsRef.current?.close();
      wsRef.current = null;
    };
    // 画面を隠したら切り、戻ったらつなぎ直す（裏で通信し続けない）
    const onVis = () => {
      if (document.hidden) close();
      else open();
    };
    open();
    document.addEventListener('visibilitychange', onVis);
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVis);
      close();
    };
  }, [enabled]);

  return { status, lastTick };
}
