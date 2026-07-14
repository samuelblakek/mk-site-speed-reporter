export function renderSparkline(points: Array<{ label: string; value: number }>, width = 320, height = 64): string {
  if (points.length < 2) {
    return `<p class="muted">Not enough data yet for a trend line.</p>`;
  }

  const values = points.map((p) => p.value);
  const max = Math.max(...values);
  const min = Math.min(...values);
  const range = max - min || 1;
  const stepX = width / (points.length - 1);
  const padding = 4;

  const coords = points.map((p, i) => {
    const x = i * stepX;
    const y = padding + (1 - (p.value - min) / range) * (height - padding * 2);
    return { x, y, value: p.value, label: p.label };
  });

  const polyline = coords.map((c) => `${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(" ");
  const lastPoint = coords[coords.length - 1];

  return `<svg viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="trend chart from ${points[0].label} to ${points[points.length - 1].label}">
    <polyline points="${polyline}" fill="none" stroke="currentColor" stroke-width="2" />
    <circle cx="${lastPoint.x.toFixed(1)}" cy="${lastPoint.y.toFixed(1)}" r="3" fill="currentColor" />
  </svg>`;
}
