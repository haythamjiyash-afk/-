import type { RatingThreshold } from './types.ts';

export const DEFAULT_RATING_THRESHOLDS: RatingThreshold[] = [
  { id: 'excellent', label: 'ممتاز', minScore: 9, color: '#16A34A' },
  { id: 'very_good', label: 'جيد جدًا', minScore: 8, color: '#0284C7' },
  { id: 'good', label: 'جيد', minScore: 7, color: '#4F46E5' },
  { id: 'acceptable', label: 'مقبول', minScore: 6, color: '#D97706' },
  { id: 'needs_improvement', label: 'يحتاج إلى تحسين', minScore: 0, color: '#DC2626' },
];

export function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function calculateReportMetrics(
  scores: number[],
  disciplineScore: number,
  thresholds: RatingThreshold[]
): {
  criteriaAverage: number;
  overallAverage: number;
  overallPercentage: number;
  ratingLabel: string;
  ratingColor: string;
} {
  const divisor = scores.length > 0 ? scores.length : 9;
  const sum = scores.reduce((acc, s) => acc + s, 0);
  const criteriaAverage = round2(sum / divisor);
  const overallAverage = round2((criteriaAverage + disciplineScore) / 2);
  const overallPercentage = round2(overallAverage * 10);

  const sorted = [...thresholds].sort((a, b) => b.minScore - a.minScore);
  const matched =
    sorted.find((t) => overallAverage >= t.minScore) ??
    sorted[sorted.length - 1] ?? {
      label: 'يحتاج إلى تحسين',
      color: '#DC2626',
    };

  return {
    criteriaAverage,
    overallAverage,
    overallPercentage,
    ratingLabel: matched.label,
    ratingColor: matched.color,
  };
}
