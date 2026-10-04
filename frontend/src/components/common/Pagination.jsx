import { ChevronLeft, ChevronRight } from 'lucide-react';

import { cn } from '@/lib/utils';

const control =
  'focus-ring flex h-7 min-w-7 items-center justify-center rounded-md px-1.5 text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-35';

/* Page x of y, previous / next. Numbers are mono so they do not jump. */
export function Pagination({ page, totalPages, onPage, className }) {
  if (totalPages <= 1) return null;
  return (
    <nav aria-label="Pagination" className={cn('flex items-center justify-between gap-3 px-3 py-2', className)}>
      <p className="data text-xs text-muted-foreground">
        {page} / {totalPages}
      </p>
      <div className="flex items-center gap-0.5">
        <button
          type="button"
          onClick={() => onPage(page - 1)}
          disabled={page <= 1}
          aria-label="Previous page"
          className={cn(control, 'text-muted-foreground hover:bg-white/[0.07] hover:text-foreground')}
        >
          <ChevronLeft className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={() => onPage(page + 1)}
          disabled={page >= totalPages}
          aria-label="Next page"
          className={cn(control, 'text-muted-foreground hover:bg-white/[0.07] hover:text-foreground')}
        >
          <ChevronRight className="h-3.5 w-3.5" />
        </button>
      </div>
    </nav>
  );
}
