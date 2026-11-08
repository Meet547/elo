export interface GraphPoint {
  value: number;
  at: string;
  label?: string;
}

export const REFRESH_THRESHOLD = 58;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** Include the rating before the window's first session in its total gain. */
export function ratingWindow(points: GraphPoint[], sessions: number | null) {
  return sessions === null ? points : points.slice(-(sessions + 1));
}

/** Both operands are screen pixels, so the ratio also works in a scaled card. */
export function ratingIndex(clientX: number, left: number, width: number, length: number) {
  return Math.round(clamp((clientX - left) / (width || 1), 0, 1) * Math.max(0, length - 1));
}

export function ratingReading(points: GraphPoint[], index: number | null) {
  if (!points.length) return null;
  const selected = index === null ? points.length - 1 : clamp(Math.round(index), 0, points.length - 1);
  const point = points[selected];
  const change = point.value - points[0].value;
  return { point, index: selected, change, percent: points[0].value === 0 ? 0 : change / points[0].value * 100 };
}

export function pullDistance(raw: number, resistance = 50) {
  const rubber = 700 - clamp(resistance, 0, 100) / 100 * 380;
  const distance = Math.max(0, raw);
  return rubber * distance / (rubber + distance);
}

/** A monotone cubic goes through every reading without inventing peaks or dips. */
export function ratingCurve(values: number[], height = 160) {
  if (!values.length) return { path: "", points: [] };
  const low = Math.min(...values);
  const high = Math.max(...values);
  const points = values.map((value, index) => ({
    x: values.length === 1 ? 50 : index / (values.length - 1) * 100,
    y: high === low ? height / 2 : height - 16 - (value - low) / (high - low) * (height - 32),
  }));
  if (points.length === 1) return { path: "", points };
  const slopes = points.slice(1).map((point, index) =>
    (point.y - points[index].y) / (point.x - points[index].x));
  const tangents = points.map((_, index) => {
    if (index === 0) return slopes[0];
    if (index === points.length - 1) return slopes[slopes.length - 1];
    const before = slopes[index - 1];
    const after = slopes[index];
    return before * after <= 0 ? 0 : 2 * before * after / (before + after);
  });
  const n = (value: number) => value.toFixed(3);
  let path = `M${n(points[0].x)} ${n(points[0].y)}`;
  points.slice(1).forEach((point, index) => {
    const previous = points[index];
    const step = (point.x - previous.x) / 3;
    path += ` C${n(previous.x + step)} ${n(previous.y + tangents[index] * step)} ${n(point.x - step)} ${n(point.y - tangents[index + 1] * step)} ${n(point.x)} ${n(point.y)}`;
  });
  return { path, points };
}
