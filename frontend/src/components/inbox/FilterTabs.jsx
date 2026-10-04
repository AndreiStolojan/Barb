import { RISK_FILTERS, getRiskMeta } from '@/lib/risk';
import { cn } from '@/lib/utils';

const underlineColor = (key) => (key ? getRiskMeta(key).tone.hex : 'var(--color-foreground)');

/* The risk filters, as tabs. The active underline carries the category colour. */
export function FilterTabs({ active, counts, showCounts = true, onSelect }) {
  return (
    <div role="tablist" aria-label="Filter messages by risk" className="scrollbar-none flex shrink-0 items-stretch gap-x-0.5 overflow-x-auto border-b border-border px-2">
      {RISK_FILTERS.map(({ key, label }, index) => {
        const isActive = active === key;
        const count = counts?.[key];
        return (
          <button
            key={key || 'all'}
            type="button"
            role="tab"
            aria-selected={isActive}
            aria-keyshortcuts={String(index + 1)}
            onClick={() => onSelect(key)}
            className={cn(
              'focus-ring relative flex items-baseline gap-1.5 whitespace-nowrap px-2.5 py-2 text-xs transition-colors',
              isActive ? 'font-medium text-foreground' : 'text-muted-foreground hover:text-foreground'
            )}
          >
            <span>{label}</span>
            {showCounts && Number.isFinite(count) && (
              <span className={cn('data text-[0.6875rem]', isActive ? 'text-muted-foreground' : 'text-muted-foreground-subtle')}>{count}</span>
            )}
            {isActive && (
              <span aria-hidden="true" className="absolute inset-x-2 -bottom-px h-[2px] rounded-full" style={{ backgroundColor: underlineColor(key) }} />
            )}
          </button>
        );
      })}
    </div>
  );
}
