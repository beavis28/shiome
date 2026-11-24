import type { ReactNode } from 'react';
import type { Tone } from '../lib/indicators';

const TONE: Record<Tone, string> = {
  up: 'bg-upc/15 text-upc ring-upc/40',
  down: 'bg-downc/15 text-downc ring-downc/40',
  warn: 'bg-warnc/15 text-warnc ring-warnc/40',
  neutral: 'bg-white/5 text-mute ring-white/10',
};

export function Badge({ tone, children, title }: { tone: Tone; children: ReactNode; title?: string }) {
  return (
    <span title={title} className={`inline-flex items-center whitespace-nowrap rounded px-1.5 py-0.5 text-[11px] font-medium ring-1 ring-inset ${TONE[tone]}`}>
      {children}
    </span>
  );
}

export function Card({ title, right, children, className = '' }: { title?: ReactNode; right?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-lg border border-line bg-panel ${className}`}>
      {title && (
        <header className="flex items-center justify-between border-b border-line px-3 py-1.5">
          <h2 className="text-xs font-semibold tracking-wide text-mute">{title}</h2>
          {right}
        </header>
      )}
      {children}
    </section>
  );
}

export const changeColor = (v: number | null | undefined) =>
  v === null || v === undefined || v === 0 ? 'text-mute' : v > 0 ? 'text-upc' : 'text-downc';
