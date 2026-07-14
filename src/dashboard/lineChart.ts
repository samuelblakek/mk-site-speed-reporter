export interface SeriesPoint {
  date: string;
  value: number | null;
}

export interface ChartSeries {
  key: string;
  label: string;
  colorVar: string; // e.g. "var(--series-mobile)"
  points: SeriesPoint[];
}

let chartCounter = 0;

// A multi-series line chart with a shared x-axis, direct end-labels, and a hover
// crosshair+tooltip that lists every series at that date (per dataviz skill: "one tooltip,
// every series" - the reader never has to land precisely on a line to get a value).
export function renderLineChart(series: ChartSeries[], opts: { width?: number; height?: number; valueSuffix?: string } = {}): string {
  const width = opts.width ?? 600;
  const height = opts.height ?? 180;
  const padding = { top: 12, right: 16, bottom: 24, left: 16 };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;
  const id = `chart-${chartCounter++}`;
  const valueSuffix = opts.valueSuffix ?? "";

  const allDates = [...new Set(series.flatMap((s) => s.points.map((p) => p.date)))].sort();
  const allValues = series.flatMap((s) => s.points.map((p) => p.value)).filter((v): v is number => v != null);

  if (allDates.length < 2 || allValues.length === 0) {
    return `<p class="muted">Not enough data yet for a trend line.</p>`;
  }

  const max = Math.max(...allValues);
  const min = Math.min(0, ...allValues);
  const range = max - min || 1;

  const xForIndex = (i: number) => padding.left + (allDates.length === 1 ? 0 : (i / (allDates.length - 1)) * plotWidth);
  const yForValue = (v: number) => padding.top + (1 - (v - min) / range) * plotHeight;

  const gridlineY = [0, 0.5, 1].map((f) => padding.top + f * plotHeight);

  const seriesSvg = series
    .map((s) => {
      const coords = s.points
        .filter((p) => p.value != null)
        .map((p) => ({ x: xForIndex(allDates.indexOf(p.date)), y: yForValue(p.value as number), value: p.value as number }));
      if (coords.length === 0) return "";

      const path = coords.map((c, i) => `${i === 0 ? "M" : "L"}${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(" ");
      const last = coords[coords.length - 1];
      const lastLabel = `${last.value.toFixed(last.value < 10 ? 2 : 0)}${valueSuffix}`;

      return `
        <path d="${path}" fill="none" stroke="${s.colorVar}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
        <circle cx="${last.x.toFixed(1)}" cy="${last.y.toFixed(1)}" r="4" fill="${s.colorVar}" stroke="var(--surface-1)" stroke-width="2" />
        <text x="${Math.min(last.x + 6, width - 4)}" y="${last.y.toFixed(1)}" dominant-baseline="middle" text-anchor="${last.x + 6 > width - 40 ? "end" : "start"}" font-weight="600" fill="${s.colorVar}">${lastLabel}</text>
      `;
    })
    .join("\n");

  const firstDate = allDates[0];
  const lastDate = allDates[allDates.length - 1];

  // Tooltip payload: one row per date, one value per series - lets the hover layer show
  // "every series at that X" without the pointer needing to land on a specific line.
  const tooltipData = allDates.map((date) => ({
    date,
    values: series.map((s) => ({ label: s.label, color: s.colorVar, value: s.points.find((p) => p.date === date)?.value ?? null })),
  }));

  return `
<div class="chart-wrap" id="${id}">
  <svg class="trend-chart" viewBox="0 0 ${width} ${height}" data-chart-id="${id}" role="img" aria-label="Trend from ${firstDate} to ${lastDate}">
    ${gridlineY.map((y) => `<line class="gridline" x1="${padding.left}" y1="${y.toFixed(1)}" x2="${width - padding.right}" y2="${y.toFixed(1)}" />`).join("\n")}
    ${seriesSvg}
    <line class="crosshair" x1="0" y1="${padding.top}" x2="0" y2="${padding.top + plotHeight}" />
    <text x="${padding.left}" y="${height - 6}" text-anchor="start">${firstDate}</text>
    <text x="${width - padding.right}" y="${height - 6}" text-anchor="end">${lastDate}</text>
    <rect x="${padding.left}" y="0" width="${plotWidth}" height="${height}" fill="transparent" data-hit-area="${id}" />
  </svg>
  <div class="chart-tooltip" data-tooltip-for="${id}"></div>
</div>
<script type="application/json" id="${id}-data">${JSON.stringify({ dates: allDates, rows: tooltipData, padding, plotWidth, width, height })}</script>
`;
}

// Single shared hover script for every chart on the page - reads each chart's JSON payload
// and drives its crosshair + tooltip. Vanilla JS, no dependency, executes after streaming.
export const CHART_INTERACTION_SCRIPT = `
document.querySelectorAll('svg.trend-chart').forEach((svg) => {
  const id = svg.getAttribute('data-chart-id');
  const dataEl = document.getElementById(id + '-data');
  if (!dataEl) return;
  const chartData = JSON.parse(dataEl.textContent);
  const wrap = document.getElementById(id);
  const tooltip = wrap.querySelector('[data-tooltip-for="' + id + '"]');
  const crosshair = svg.querySelector('.crosshair');
  const hitArea = svg.querySelector('[data-hit-area="' + id + '"]');
  if (!hitArea) return;

  function nearestIndex(px) {
    const frac = (px - chartData.padding.left) / chartData.plotWidth;
    const i = Math.round(frac * (chartData.dates.length - 1));
    return Math.max(0, Math.min(chartData.dates.length - 1, i));
  }

  function show(clientX, clientY) {
    const rect = svg.getBoundingClientRect();
    const scale = chartData.width / rect.width;
    const px = (clientX - rect.left) * scale;
    const i = nearestIndex(px);
    const x = chartData.padding.left + (chartData.dates.length === 1 ? 0 : (i / (chartData.dates.length - 1)) * chartData.plotWidth);
    crosshair.setAttribute('x1', x);
    crosshair.setAttribute('x2', x);
    crosshair.style.opacity = '1';

    const row = chartData.rows[i];
    tooltip.replaceChildren();
    const dateEl = document.createElement('div');
    dateEl.className = 'tt-date';
    dateEl.textContent = row.date;
    tooltip.appendChild(dateEl);
    for (const v of row.values) {
      if (v.value == null) continue;
      const rowEl = document.createElement('div');
      rowEl.className = 'tt-row';
      const key = document.createElement('span');
      key.className = 'tt-key';
      key.style.background = v.color;
      const labelText = document.createTextNode(v.label);
      const valueEl = document.createElement('span');
      valueEl.className = 'tt-value';
      valueEl.textContent = String(v.value);
      rowEl.append(key, labelText, valueEl);
      tooltip.appendChild(rowEl);
    }
    tooltip.style.opacity = '1';
    const wrapRect = wrap.getBoundingClientRect();
    const left = Math.min((x / chartData.width) * wrapRect.width, wrapRect.width - 140);
    tooltip.style.left = Math.max(0, left) + 'px';
    tooltip.style.top = '4px';
  }

  function hide() {
    crosshair.style.opacity = '0';
    tooltip.style.opacity = '0';
  }

  hitArea.addEventListener('pointermove', (e) => show(e.clientX, e.clientY));
  hitArea.addEventListener('pointerleave', hide);
  hitArea.addEventListener('focus', () => show(hitArea.getBoundingClientRect().left, 0));
  hitArea.addEventListener('blur', hide);
});
`;
