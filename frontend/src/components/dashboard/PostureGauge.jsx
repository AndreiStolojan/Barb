// A 270° arc with the safe rate in the middle. The arc and the numeral take
// their colour from the continuous health ramp, so 12% never looks as calm as
// 98%. Animates once on mount; respects reduced motion.

import { useEffect } from 'react';
import { animate, motion, useMotionValue, useTransform } from 'framer-motion';

import { getHealthColor, getHealthTextColor, getPostureLabel } from '@/lib/scoreScale';
import { dur, ease } from '@/lib/motion';

const ARC_SPAN = 75; // of pathLength 100; the bottom quarter is the gap

const prefersReducedMotion = () =>
  typeof window !== 'undefined' &&
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export function PostureGauge({ value = 0, size = 168 }) {
  const pct = Number.isFinite(value) ? Math.min(100, Math.max(0, Math.round(value))) : 0;
  const filled = (ARC_SPAN / 100) * pct;
  const arcColor = getHealthColor(pct);
  const numeralColor = getHealthTextColor(pct);

  const progress = useMotionValue(filled);
  const dashArray = useTransform(progress, (v) => `${v} ${100 - v}`);

  useEffect(() => {
    if (prefersReducedMotion()) {
      progress.set(filled);
      return undefined;
    }
    const controls = animate(progress, filled, { duration: dur.slow, ease });
    return () => controls.stop();
  }, [filled, progress]);

  return (
    <div style={{ width: size, height: size }} className="shrink-0">
      <svg
        viewBox="0 0 220 220"
        role="img"
        aria-label={`Safe rate ${pct} percent. ${getPostureLabel(pct)}.`}
        className="block h-full w-full overflow-visible"
      >
        <circle
          cx="110"
          cy="110"
          r="92"
          pathLength="100"
          fill="none"
          strokeWidth="6"
          strokeLinecap="round"
          strokeDasharray={`${ARC_SPAN} ${100 - ARC_SPAN}`}
          transform="rotate(135 110 110)"
          stroke="rgb(255 255 255 / 0.1)"
        />
        <motion.circle
          cx="110"
          cy="110"
          r="92"
          pathLength="100"
          fill="none"
          strokeWidth="6"
          strokeLinecap="round"
          transform="rotate(135 110 110)"
          style={{ strokeDasharray: dashArray }}
          initial={false}
          animate={{ stroke: arcColor }}
          transition={{ duration: dur.base, ease }}
        />
        <motion.text
          x="110"
          y="124"
          textAnchor="middle"
          initial={false}
          animate={{ fill: numeralColor }}
          transition={{ duration: dur.base, ease }}
          style={{ fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums' }}
        >
          <tspan style={{ fontSize: 60, fontWeight: 500, letterSpacing: '-0.04em' }}>{pct}</tspan>
          <tspan dx="2" style={{ fontSize: 20, fontWeight: 400, fill: 'var(--color-muted-foreground)' }}>
            %
          </tspan>
        </motion.text>
        <text
          x="110"
          y="156"
          textAnchor="middle"
          style={{ fontSize: 12, fontWeight: 500, fill: 'var(--color-muted-foreground)' }}
        >
          safe
        </text>
      </svg>
    </div>
  );
}
