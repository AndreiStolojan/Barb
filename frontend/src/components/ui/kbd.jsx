import { cn } from '@/lib/utils';

/* A keyboard hint, e.g. <Kbd>j</Kbd>. Decorative: the real affordance is the
   shortcut itself, so it is hidden from assistive tech. */
export function Kbd({ className, children }) {
  return (
    <kbd aria-hidden="true" className={cn('kbd', className)}>
      {children}
    </kbd>
  );
}
