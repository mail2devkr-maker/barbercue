// Pure geometry for the dashboard charts, kept out of the components so it can be unit-tested.

export interface XY {
  x: number;
  y: number;
}

/**
 * A smooth curve through the points that never overshoots them (monotone cubic interpolation,
 * Fritsch-Carlson). A plain spline would dip below zero between two zero-revenue days and invent a
 * "loss" that is not in the data; this one cannot.
 */
export function monotonePath(points: readonly XY[]): string {
  const n = points.length;
  if (n === 0) return "";
  const f = (v: number) => v.toFixed(1);
  if (n === 1) return `M${f(points[0].x)},${f(points[0].y)}`;
  const dx: number[] = [];
  const slope: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    dx.push(points[i + 1].x - points[i].x);
    slope.push(dx[i] === 0 ? 0 : (points[i + 1].y - points[i].y) / dx[i]);
  }
  const tangent: number[] = new Array(n).fill(0);
  tangent[0] = slope[0];
  tangent[n - 1] = slope[n - 2];
  for (let i = 1; i < n - 1; i++) {
    if (slope[i - 1] * slope[i] <= 0) tangent[i] = 0;
    else tangent[i] = (slope[i - 1] + slope[i]) / 2;
  }
  for (let i = 0; i < n - 1; i++) {
    if (slope[i] === 0) {
      tangent[i] = 0;
      tangent[i + 1] = 0;
      continue;
    }
    const a = tangent[i] / slope[i];
    const b = tangent[i + 1] / slope[i];
    const s = a * a + b * b;
    if (s > 9) {
      const t = 3 / Math.sqrt(s);
      tangent[i] = t * a * slope[i];
      tangent[i + 1] = t * b * slope[i];
    }
  }
  let d = `M${f(points[0].x)},${f(points[0].y)}`;
  for (let i = 0; i < n - 1; i++) {
    const h = dx[i];
    d += ` C${f(points[i].x + h / 3)},${f(points[i].y + (tangent[i] * h) / 3)} ${f(points[i + 1].x - h / 3)},${f(points[i + 1].y - (tangent[i + 1] * h) / 3)} ${f(points[i + 1].x)},${f(points[i + 1].y)}`;
  }
  return d;
}

export function niceMax(value: number): number {
  if (value <= 0) return 1;
  const exp = Math.pow(10, Math.floor(Math.log10(value)));
  const f = value / exp;
  const nice = f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10;
  return nice * exp;
}

/** The mean of a series, or null when there is nothing to average (never a made-up 0). */
export function average(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}
