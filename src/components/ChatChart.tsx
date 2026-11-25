import { lazy, Suspense } from 'react';
import type { ChartSpec } from '../types';
import { useT } from '../lib/i18n';

// グラフのライブラリは大きいので、図が出たときにだけ読み込む
const ChartJsView = lazy(() => import('./charts/ChartJsView'));
const Scatter3D = lazy(() => import('./charts/Scatter3D'));

export function ChatChart({ spec }: { spec: ChartSpec }) {
  const { t } = useT();
  const unit = spec.unit.replace(/[（）]/g, '');
  return (
    <figure className="my-2 rounded-lg border border-line bg-bg/60 p-3">
      <figcaption className="mb-1.5 flex items-baseline justify-between gap-2">
        <span className="text-xs font-semibold text-ink">{spec.title}</span>
        {unit && <span className="text-[10px] text-mute">{t('単位', 'Unit')}: {unit}</span>}
      </figcaption>
      <Suspense fallback={<div className="flex h-[200px] items-center justify-center text-[11px] text-mute">{t('グラフを読み込み中…', 'Loading chart…')}</div>}>
        {spec.kind === 'scatter3d' ? <Scatter3D spec={spec} /> : <ChartJsView spec={spec} />}
      </Suspense>
      {spec.source && <p className="mt-1.5 text-[10px] text-mute">{t('出典', 'Source')}: {spec.source}</p>}
    </figure>
  );
}
