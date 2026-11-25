// Chart.js で描く 2D のグラフ（棒・横棒・折れ線・面・ドーナツ・レーダー・散布図・バブル）
import { useEffect, useRef } from 'react';
import Chart from 'chart.js/auto';
import type { ChartConfiguration, Plugin } from 'chart.js';
import type { ChartSpec } from '../../types';
import { tr, useLang } from '../../lib/i18n';
import { alpha, fmtNum, GRID, INK, MUTE, NEG, PALETTE, SURFACE } from './palette';

Chart.defaults.color = MUTE;
Chart.defaults.borderColor = GRID;
Chart.defaults.font.family = "Inter, 'Hiragino Sans', 'Noto Sans JP', system-ui, sans-serif";
Chart.defaults.font.size = 11;

// 散布図・バブルで、点の横に銘柄名を書く（点が多すぎるときは書かない）
const pointLabels: Plugin = {
  id: 'pointLabels',
  afterDatasetsDraw(chart) {
    const type = (chart.config as { type?: string }).type;
    if (type !== 'scatter' && type !== 'bubble') return;
    const total = chart.data.datasets.reduce((a, d) => a + d.data.length, 0);
    if (total > 30) return;
    const { ctx } = chart;
    ctx.save();
    ctx.font = '600 10px Inter, sans-serif';
    ctx.fillStyle = INK;
    chart.data.datasets.forEach((ds, di) => {
      const meta = chart.getDatasetMeta(di);
      if (meta.hidden) return;
      meta.data.forEach((el, i) => {
        const p = ds.data[i] as { label?: string; r?: number };
        if (!p?.label) return;
        const r = typeof p.r === 'number' ? p.r : 4;
        ctx.fillText(p.label, el.x + r + 3, el.y + 3);
      });
    });
    ctx.restore();
  },
};

const groupsOf = (spec: ChartSpec) => {
  const names = [...new Set((spec.points ?? []).map((p) => p.group ?? ''))];
  return names.length ? names : [''];
};

function build(spec: ChartSpec): ChartConfiguration {
  const unit = spec.unit;
  const labels = spec.labels ?? [];
  const series = spec.series ?? [];
  const tooltipValue = (v: number) => fmtNum(v, unit);
  const axisTitle = (t?: string) => (t ? { display: true, text: t, color: MUTE } : { display: false });

  if (spec.kind === 'doughnut') {
    const s = series[0];
    return {
      type: 'doughnut',
      data: {
        labels,
        datasets: [{ data: s.values, backgroundColor: labels.map((_, i) => PALETTE[i % PALETTE.length]), borderColor: SURFACE, borderWidth: 2, hoverOffset: 6, cutout: '58%' } as never],
      },
      options: {
        plugins: {
          legend: { position: 'right', labels: { boxWidth: 10, color: INK } },
          tooltip: {
            callbacks: {
              label: (c) => {
                const total = (c.dataset.data as (number | null)[]).reduce<number>((a, b) => a + (b ?? 0), 0);
                const v = c.parsed as number;
                return ` ${c.label}: ${tooltipValue(v)}（${((v / total) * 100).toFixed(1)}%）`;
              },
            },
          },
        },
      },
    };
  }

  if (spec.kind === 'radar') {
    return {
      type: 'radar',
      data: {
        labels,
        datasets: series.map((s, i) => ({
          label: s.name,
          data: s.values,
          borderColor: PALETTE[i],
          backgroundColor: alpha(PALETTE[i], 0.15),
          borderWidth: 2,
          pointRadius: 3,
          pointBackgroundColor: PALETTE[i],
        })),
      },
      options: {
        scales: { r: { angleLines: { color: GRID }, grid: { color: GRID }, pointLabels: { color: INK, font: { size: 11 } }, ticks: { backdropColor: 'transparent', color: MUTE } } },
        plugins: { legend: { display: series.length > 1, labels: { boxWidth: 10, color: INK } }, tooltip: { callbacks: { label: (c) => ` ${c.dataset.label}: ${tooltipValue(c.parsed.r)}` } } },
      },
    };
  }

  if (spec.kind === 'scatter' || spec.kind === 'bubble') {
    const pts = spec.points ?? [];
    const maxR = Math.max(1, ...pts.map((p) => Math.abs(p.r ?? 0)));
    const groups = groupsOf(spec);
    return {
      type: spec.kind,
      data: {
        datasets: groups.map((g, gi) => ({
          label: g || spec.title,
          data: pts
            .filter((p) => (p.group ?? '') === g)
            .map((p) => ({ x: p.x, y: p.y, label: p.label, raw: p.r, r: spec.kind === 'bubble' ? 4 + Math.sqrt(Math.abs(p.r ?? 0) / maxR) * 22 : undefined })),
          backgroundColor: alpha(PALETTE[gi % PALETTE.length], spec.kind === 'bubble' ? 0.55 : 0.9),
          borderColor: PALETTE[gi % PALETTE.length],
          borderWidth: 1.5,
          pointRadius: 5,
          pointHoverRadius: 7,
        })),
      },
      options: {
        scales: {
          x: { title: axisTitle(spec.xTitle), grid: { color: GRID } },
          y: { title: axisTitle(spec.yTitle), grid: { color: GRID } },
        },
        plugins: {
          legend: { display: groups.length > 1, labels: { boxWidth: 10, color: INK } },
          tooltip: {
            callbacks: {
              label: (c) => {
                const p = c.raw as { x: number; y: number; label: string; raw?: number };
                return ` ${p.label}: ${spec.xTitle ?? 'x'} ${fmtNum(p.x)} / ${spec.yTitle ?? 'y'} ${fmtNum(p.y)}${p.raw !== undefined ? ` / ${tr('大きさ', 'Size')} ${fmtNum(p.raw)}` : ''}`;
              },
            },
          },
        },
      },
      plugins: [pointLabels],
    };
  }

  // bar / hbar / line / area
  const isBar = spec.kind === 'bar' || spec.kind === 'hbar';
  const single = series.length === 1;
  return {
    type: isBar ? 'bar' : 'line',
    data: {
      labels,
      datasets: series.map((s, i) => ({
        label: s.name,
        data: s.values,
        borderColor: PALETTE[i],
        backgroundColor: isBar
          ? single
            ? s.values.map((v) => ((v ?? 0) < 0 ? NEG : PALETTE[0]))
            : PALETTE[i]
          : alpha(PALETTE[i], spec.kind === 'area' ? 0.18 : 0),
        fill: spec.kind === 'area' ? (series.length > 1 ? false : 'origin') : false,
        borderWidth: isBar ? 0 : 2,
        borderRadius: isBar ? 4 : 0,
        borderSkipped: 'start',
        pointRadius: 0,
        pointHoverRadius: 4,
        tension: 0.2,
        spanGaps: true,
        maxBarThickness: 28,
      })),
    },
    options: {
      indexAxis: spec.kind === 'hbar' ? 'y' : 'x',
      interaction: { mode: 'index', intersect: false },
      scales: {
        x: { title: axisTitle(spec.xTitle), grid: { display: spec.kind === 'hbar', color: GRID }, ticks: { maxRotation: 0, autoSkip: true, autoSkipPadding: 12 } },
        y: { title: axisTitle(spec.yTitle), grid: { display: spec.kind !== 'hbar', color: GRID } },
      },
      plugins: {
        legend: { display: !single, labels: { boxWidth: 10, color: INK } },
        tooltip: { callbacks: { label: (c) => ` ${c.dataset.label}: ${tooltipValue((spec.kind === 'hbar' ? c.parsed.x : c.parsed.y) as number)}` } },
      },
    },
  };
}

export default function ChartJsView({ spec }: { spec: ChartSpec }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const lang = useLang();
  useEffect(() => {
    if (!ref.current) return;
    const cfg = build(spec);
    cfg.options = { ...cfg.options, responsive: true, maintainAspectRatio: false, animation: { duration: 500 } };
    const chart = new Chart(ref.current, cfg);
    return () => chart.destroy();
    // lang: ツールチップの文言を切り替えるため作り直す
  }, [spec, lang]);
  const tall = spec.kind === 'hbar' ? Math.max(200, (spec.labels?.length ?? 5) * 26 * Math.max(1, (spec.series?.length ?? 1) * 0.6)) : spec.kind === 'doughnut' || spec.kind === 'radar' ? 260 : 240;
  return (
    <div className="relative w-full" style={{ height: tall }}>
      <canvas ref={ref} role="img" aria-label={spec.title} />
    </div>
  );
}
