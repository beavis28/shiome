// 経済ニュースのライブ配信（YouTube の公式チャンネルの 24 時間ライブを埋め込み）
// 小窓（ドラッグで移動）⇔ 拡大 を切り替えられる。画面の他の部分は触らない。
import { useEffect, useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import { api } from '../lib/api';

export const TV_CHANNELS = [
  { id: 'UCIALMKvObZNtJ6AmdCLP7Lg', name: 'Bloomberg', note: 'Bloomberg Television（英語）' },
  { id: 'UCEAZeUIeJs0IjQiqTCdVSIg', name: 'Yahoo Finance', note: 'Yahoo Finance Live（英語）' },
  { id: 'UCSPEjw8F2nQDtmUKPFNF7_A', name: 'NHK WORLD', note: 'NHK WORLD-JAPAN（英語）' },
  { id: 'UCoMdktPbSTixAyNGwb-UYkQ', name: 'Sky News', note: 'Sky News（英語）' },
  { id: 'UCknLrEdhRCp1aegoMqRaCZg', name: 'DW News', note: 'DW News（英語）' },
];

const KEY = 'shiome.tv';
type Saved = { channel: string; x: number; y: number; w: number };
const read = (): Saved => {
  const d = { channel: TV_CHANNELS[0].id, x: 12, y: -12, w: 400 };
  try {
    return { ...d, ...(JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Saved>) };
  } catch {
    return d;
  }
};

export function TvPlayer({ onClose }: { onClose: () => void }) {
  const [saved, setSaved] = useState<Saved>(read);
  const [expanded, setExpanded] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const ch = TV_CHANNELS.find((c) => c.id === saved.channel) ?? TV_CHANNELS[0];

  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(saved));
    } catch {
      /* 無視 */
    }
  }, [saved]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setExpanded(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // 小窓のときだけ、見出し部分をドラッグして移動できる（x は左から、y は下から。負の y は下端からの距離）
  const drag = (e: RPointerEvent) => {
    if (expanded || (e.target as HTMLElement).closest('button,select,a')) return;
    const start = { px: e.clientX, py: e.clientY, x: saved.x, y: saved.y };
    const move = (ev: PointerEvent) =>
      setSaved((s) => ({
        ...s,
        x: Math.max(0, Math.min(window.innerWidth - s.w, start.x + ev.clientX - start.px)),
        y: Math.min(-8, Math.max(-(window.innerHeight - 80), start.y + ev.clientY - start.py)),
      }));
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  // いまのライブ動画の ID を調べて埋め込む。わからなければチャンネル指定の埋め込みにする
  const [video, setVideo] = useState<{ ch: string; id: string | null } | null>(null);
  useEffect(() => {
    let alive = true;
    api.tv(ch.id).then(
      (r) => alive && setVideo({ ch: ch.id, id: r.videoId }),
      () => alive && setVideo({ ch: ch.id, id: null }),
    );
    return () => {
      alive = false;
    };
  }, [ch.id]);
  const params = 'autoplay=1&mute=1&playsinline=1&rel=0';
  const src =
    video?.ch !== ch.id
      ? null
      : video.id
        ? `https://www.youtube.com/embed/${video.id}?${params}`
        : `https://www.youtube.com/embed/live_stream?channel=${ch.id}&${params}`;

  return (
    <>
      {expanded && <div className="fixed inset-0 z-[55] bg-black/70" onClick={() => setExpanded(false)} />}
      <div
        ref={boxRef}
        className={`fixed z-[56] overflow-hidden rounded-xl border border-line bg-panel shadow-2xl ${expanded ? 'left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2' : 'max-md:!bottom-[68px] max-md:!left-2 max-md:!w-[calc(100vw-16px)]'}`}
        style={expanded ? { width: 'min(1100px, 92vw)' } : { left: saved.x, bottom: -saved.y, width: saved.w }}
      >
        <div onPointerDown={drag} className={`flex items-center gap-2 border-b border-line px-2.5 py-1.5 ${expanded ? '' : 'cursor-move'}`}>
          <span className="flex items-center gap-1 text-[11px] font-semibold text-downc">
            <i className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-downc" />
            LIVE
          </span>
          <select
            value={ch.id}
            onChange={(e) => setSaved((s) => ({ ...s, channel: e.target.value }))}
            className="rounded border border-line bg-bg px-1.5 py-0.5 text-[11px] outline-none"
            aria-label="チャンネル"
          >
            {TV_CHANNELS.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          {expanded && <span className="truncate text-[10px] text-mute">{ch.note}</span>}
          <span className="ml-auto flex shrink-0 items-center gap-1">
            {!expanded && (
              <>
                <button title="小さく" onClick={() => setSaved((s) => ({ ...s, w: Math.max(280, s.w - 80) }))} className="rounded px-1.5 text-xs text-mute hover:bg-white/5 hover:text-ink">
                  −
                </button>
                <button title="大きく" onClick={() => setSaved((s) => ({ ...s, w: Math.min(720, s.w + 80) }))} className="rounded px-1.5 text-xs text-mute hover:bg-white/5 hover:text-ink">
                  ＋
                </button>
              </>
            )}
            <button
              onClick={() => setExpanded((v) => !v)}
              title={expanded ? '小窓に戻す（Esc）' : '拡大する'}
              className="whitespace-nowrap rounded border border-line px-2 py-0.5 text-[11px] hover:bg-white/5"
            >
              {expanded ? '⤡ 小窓' : '⤢ 拡大'}
            </button>
            <a
              href={`https://www.youtube.com/channel/${ch.id}/live`}
              target="_blank"
              rel="noreferrer noopener"
              title="YouTube で開く"
              className="rounded px-1.5 text-[11px] text-mute hover:bg-white/5 hover:text-ink"
            >
              ↗
            </a>
            <button onClick={onClose} title="閉じる" className="rounded px-1.5 text-xs text-mute hover:bg-white/5 hover:text-ink">
              ✕
            </button>
          </span>
        </div>
        <div className="relative aspect-video w-full bg-black">
          {src ? (
          <iframe
            key={src}
            src={src}
            title={`${ch.name} ライブ`}
            className="absolute inset-0 h-full w-full"
            allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
            allowFullScreen
            referrerPolicy="strict-origin-when-cross-origin"
          />
          ) : (
            <div className="absolute inset-0 flex items-center justify-center text-[11px] text-mute">配信を探しています…</div>
          )}
        </div>
        {expanded && <p className="px-3 py-1.5 text-[10px] text-mute">各社が YouTube で公開している無料のライブ配信です。最初は音声が消えているので、プレーヤーの音量ボタンで音を出してください。</p>}
      </div>
    </>
  );
}
