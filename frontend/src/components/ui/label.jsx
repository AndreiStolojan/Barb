import * as LabelPrimitive from '@radix-ui/react-label';

import { cn } from '@/lib/utils';

function Label({ className, ...props }) {
  return (
    <LabelPrimitive.Root
      className={cn('block text-xs font-medium text-muted-foreground', className)}
      {...props}
    />
  );
}

export { Label };
