import { RISK_FILTERS } from '@/lib/risk';
import { cn } from '@/lib/utils';

// Short labels for a narrow list column. The full names live in risk.js.
const SHORT = { '': 'All', quarantine: 'Phishing', needs_review: 'Suspicious', confirmed_phishing: 'Confirmed', safe: 'Safe' };

// Only the filters that hold flagged mail show a count: "Safe 289" is noise.
const COUNTED = new Set(['quarantine', 'needs_review', 'confirmed_phishing']);

/* The risk filters, as quiet pills. The active one takes the panel colour. */
export function FilterTabs({ active, counts, showCounts = true, onSelect }) {
  return (
    <div role="tablist" aria-label="Filter messages by risk" className="scrollbar-none flex shrink-0 items-center gap-0.5 overflow-x-auto px-2">
      {RISK_FILTERS.map(({ key, label }) => {
        const isActive = active === key;
        const count = counts?.[key];
        return (
          <button
            key={key || 'all'}
            type="button"
            role="tab"
            aria-selected={isActive}
            aria-label={label}
            onClick={() => onSelect(key)}
            className={cn(
              'focus-ring flex items-baseline gap-1.5 whitespace-nowrap rounded-[0.5625rem] px-2.5 py-1.5 text-[0.8125rem] transition-colors',
              isActive ? 'bg-panel text-foreground' : 'text-muted-foreground hover:text-foreground'
            )}
          >
            {SHORT[key] ?? label}
            {showCounts && COUNTED.has(key) && Number.isFinite(count) && count > 0 && (
              <span className="data text-muted-foreground-subtle">{count}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
