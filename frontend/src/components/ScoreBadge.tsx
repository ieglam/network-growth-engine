import { SCORE_BANDS } from '@nge/shared';

function getBand(score: number): { label: string; className: string } {
  if (score <= SCORE_BANDS.cold.max) return { label: 'Cold', className: 'text-gray-500' };
  if (score <= SCORE_BANDS.warm.max) return { label: 'Warm', className: 'text-yellow-600' };
  if (score <= SCORE_BANDS.active.max) return { label: 'Active', className: 'text-green-600' };
  return { label: 'Strong', className: 'text-purple-600' };
}

export default function ScoreBadge({ score }: { score: number }) {
  const band = getBand(score);
  return (
    <div className="flex items-center gap-1.5">
      <div className="w-8 h-2 rounded-full bg-gray-200 dark:bg-gray-700 overflow-hidden">
        <div
          className={`h-full rounded-full ${
            score <= 20
              ? 'bg-gray-400'
              : score <= 50
                ? 'bg-yellow-400'
                : score <= 75
                  ? 'bg-green-500'
                  : 'bg-purple-500'
          }`}
          style={{ width: `${score}%` }}
        />
      </div>
      <span className={`text-xs font-medium ${band.className}`}>{score}</span>
    </div>
  );
}
