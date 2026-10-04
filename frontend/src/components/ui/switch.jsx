import * as SwitchPrimitive from '@radix-ui/react-switch';

import { cn } from '@/lib/utils';

/* Small switch. On = bone fill, which is the "you chose this" colour. */
function Switch({ className, ...props }) {
  return (
    <SwitchPrimitive.Root
      className={cn(
        'focus-ring peer inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border border-transparent transition-colors duration-[var(--duration-fast)]',
        'disabled:cursor-not-allowed disabled:opacity-50',
        'data-[state=checked]:bg-primary data-[state=unchecked]:bg-white/[0.14]',
        className
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        className={cn(
          'pointer-events-none block h-4 w-4 rounded-full shadow-sm transition-[transform,background-color] duration-[var(--duration-fast)]',
          'data-[state=checked]:translate-x-4 data-[state=checked]:bg-primary-foreground data-[state=unchecked]:translate-x-0 data-[state=unchecked]:bg-foreground'
        )}
      />
    </SwitchPrimitive.Root>
  );
}

export { Switch };
