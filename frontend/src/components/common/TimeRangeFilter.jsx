// ─────────────────────────────────────────────────────────────────────────────
// TimeRangeFilter.jsx — the global time window. A button showing the current
// range, a menu of presets, and a two-month calendar for a custom span. State
// lives in TimeRangeContext; this is only the control.
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect, useRef, useState } from 'react';
import { CalendarDays, Check, ChevronLeft, ChevronRight } from 'lucide-react';

import { useTimeRange } from '@/context/TimeRangeContext';
import {
  RANGE_PRESETS,
  getPresetRange,
  getMonthMatrix,
  addMonths,
  isSameDay,
  isAfterDay,
  isInRange,
  MONTH_NAMES,
} from '@/lib/timeRange';
import { cn } from '@/lib/utils';

const WEEKDAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];

const yearOptions = (now) => {
  const y = now.getFullYear();
  return Array.from({ length: 6 }, (_, i) => y - 5 + i);
};

const select =
  'focus-ring h-8 rounded-lg bg-white/[0.04] px-2 text-[0.8125rem] text-foreground shadow-[inset_0_0_0_1px_var(--color-input)]';

function MonthGrid({ year, month, today, start, end, hovered, onHover, onPick, onMonth, years }) {
  const weeks = getMonthMatrix(year, month);
  const previewEnd = end || (start && hovered);
  const lo = start && previewEnd && previewEnd < start ? previewEnd : start;
  const hi = start && previewEnd && previewEnd < start ? start : previewEnd;

  return (
    <div className="min-w-[14rem]">
      <div className="mb-2 flex items-center gap-1.5">
        <select aria-label="Month" value={month} onChange={(e) => onMonth(year, Number(e.target.value))} className={cn(select, 'flex-1')}>
          {MONTH_NAMES.map((name, i) => (
            <option key={name} value={i}>{name}</option>
          ))}
        </select>
        <select aria-label="Year" value={year} onChange={(e) => onMonth(Number(e.target.value), month)} className={cn(select, 'w-20')}>
          {years.map((y) => (
            <option key={y} value={y}>{y}</option>
          ))}
        </select>
      </div>

      <div className="grid grid-cols-7 gap-y-0.5">
        {WEEKDAYS.map((d) => (
          <div key={d} className="data flex h-7 items-center justify-center text-[0.625rem] text-muted-foreground-subtle">{d}</div>
        ))}
        {weeks.flat().map((day) => {
          const inMonth = day.getMonth() === month;
          const disabled = isAfterDay(day, today);
          const isStart = start && isSameDay(day, start);
          const isEnd = end && isSameDay(day, end);
          const isEndpoint = isStart || isEnd;
          const between = isInRange(day, lo, hi) && !isEndpoint;
          const isToday = isSameDay(day, today);
          return (
            <button
              type="button"
              key={day.toISOString()}
              disabled={disabled}
              onMouseEnter={() => onHover(day)}
              onClick={() => onPick(day)}
              aria-current={isToday ? 'date' : undefined}
              className={cn(
                'data focus-ring mx-auto flex h-8 w-8 items-center justify-center rounded-lg text-[0.8125rem] transition-colors',
                disabled && 'cursor-not-allowed opacity-25',
                !disabled && !inMonth && 'text-muted-foreground-subtle',
                !disabled && inMonth && 'text-foreground hover:bg-white/[0.08]',
                isToday && !isEndpoint && 'underline underline-offset-4',
                between && 'bg-white/[0.1]',
                isEndpoint && 'bg-primary font-medium text-primary-foreground hover:bg-primary-hover'
              )}
            >
              {day.getDate()}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function TimeRangeFilter({ className, size = 'md' }) {
  const { label, preset, fromDate, toDate, setRange } = useTimeRange();
  const [open, setOpen] = useState(false);
  const [view, setView] = useState('presets');
  const containerRef = useRef(null);

  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const years = yearOptions(now);

  const [leftMonth, setLeftMonth] = useState(() => addMonths(today.getFullYear(), today.getMonth(), -1));
  const rightMonth = addMonths(leftMonth.year, leftMonth.month, 1);
  const [start, setStart] = useState(null);
  const [end, setEnd] = useState(null);
  const [hovered, setHovered] = useState(null);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const toggle = () => {
    if (!open) {
      setView('presets');
      setStart(fromDate);
      setEnd(toDate);
      setHovered(null);
      setLeftMonth(addMonths(today.getFullYear(), today.getMonth(), -1));
    }
    setOpen((v) => !v);
  };

  const choosePreset = (p) => {
    setRange({ ...getPresetRange(p.days, now), preset: p.key });
    setOpen(false);
  };

  const pick = (day) => {
    if (!start || end) {
      setStart(day);
      setEnd(null);
      return;
    }
    const [from, to] = day < start ? [day, start] : [start, day];
    setStart(from);
    setEnd(to);
    setRange({ from, to, preset: null });
    setOpen(false);
  };

  return (
    <div ref={containerRef} className={cn('relative inline-block', className)}>
      <button
        type="button"
        onClick={toggle}
        aria-haspopup="dialog"
        aria-expanded={open}
        className={cn(
          'focus-ring inline-flex items-center gap-2 rounded-[0.625rem] px-3.5 text-foreground shadow-[inset_0_0_0_1px_var(--color-border-strong)] transition-colors hover:bg-white/[0.05]',
          size === 'sm' ? 'h-8 text-[0.8125rem]' : 'h-9 text-sm',
          open && 'bg-white/[0.06]'
        )}
      >
        <CalendarDays className="h-4 w-4 shrink-0 text-muted-foreground-subtle" />
        {label}
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Select time range"
          className="absolute right-0 z-50 mt-2 rounded-2xl bg-popover p-1.5 shadow-lg ring-1 ring-white/[0.06]"
        >
          {view === 'presets' ? (
            <div className="flex w-48 flex-col gap-0.5">
              {RANGE_PRESETS.map((p) => (
                <button
                  type="button"
                  key={p.key}
                  onClick={() => choosePreset(p)}
                  aria-current={preset === p.key ? 'true' : undefined}
                  className="focus-ring flex h-9 w-full items-center justify-between rounded-lg px-3 text-sm text-foreground hover:bg-white/[0.07]"
                >
                  {p.label}
                  {preset === p.key && <Check className="h-3.5 w-3.5" />}
                </button>
              ))}
              <div className="my-0.5 border-t border-border" />
              <button
                type="button"
                onClick={() => setView('custom')}
                className="focus-ring flex h-9 w-full items-center justify-between rounded-lg px-3 text-sm text-foreground hover:bg-white/[0.07]"
              >
                Custom range
                <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
              </button>
            </div>
          ) : (
            <div className="p-1.5">
              <button
                type="button"
                onClick={() => setView('presets')}
                className="focus-ring mb-2 -ml-1 flex h-7 items-center gap-1 rounded-md px-1.5 text-xs text-muted-foreground hover:text-foreground"
              >
                <ChevronLeft className="h-3.5 w-3.5" />
                Back
              </button>
              <div className="flex flex-col gap-5 sm:flex-row sm:gap-6" onMouseLeave={() => setHovered(null)}>
                <MonthGrid year={leftMonth.year} month={leftMonth.month} today={today} start={start} end={end} hovered={hovered} onHover={setHovered} onPick={pick} onMonth={(y, m) => setLeftMonth({ year: y, month: m })} years={years} />
                <MonthGrid year={rightMonth.year} month={rightMonth.month} today={today} start={start} end={end} hovered={hovered} onHover={setHovered} onPick={pick} onMonth={(y, m) => setLeftMonth(addMonths(y, m, -1))} years={years} />
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
