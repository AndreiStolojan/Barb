import { cn } from '@/lib/utils';

/* Loading placeholder. A static lift, no shimmer: it should not draw the eye. */
function Skeleton({ className, ...props }) {
  return <div aria-hidden="true" className={cn('rounded-md bg-white/[0.06]', className)} {...props} />;
}

export { Skeleton };
