import { getRiskColor, isScored, UNSCORED_COLOR } from '@/lib/scoreScale';
import { SCORE_MAX } from '@/lib/scoring';
import { cn } from '@/lib/utils';

/* A 0–100 score as a thin bar, coloured from the continuous risk ramp. */
export function ScoreMeter({ score, max = SCORE_MAX, hex, className }) {
  const scored = isScored(score);
  const pct = scored ? Math.max(0, Math.min(100, (score / max) * 100)) : 0;
  const fill = hex || (scored ? getRiskColor(score) : UNSCORED_COLOR);

  return (
    <span aria-hidden="true" className={cn('relative block h-[3px] shrink-0 overflow-hidden rounded-full bg-white/[0.1]', className)}>
      <span className="absolute inset-y-0 left-0 rounded-full transition-[width] duration-[var(--duration-slow)]" style={{ width: `${pct}%`, backgroundColor: fill }} />
    </span>
  );
}
