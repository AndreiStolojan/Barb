import { Slot } from '@radix-ui/react-slot';
import { cva } from 'class-variance-authority';

import { cn } from '@/lib/utils';

/*
  One button. `primary` is the single bone-filled action a screen is allowed;
  everything else is an outline or a ghost so the hierarchy stays readable.
  `danger` is for the two verbs that destroy something.
*/
const buttonVariants = cva(
  'focus-ring inline-flex shrink-0 select-none items-center justify-center gap-1.5 whitespace-nowrap rounded-md font-medium transition-[background-color,border-color,color,opacity] duration-[var(--duration-fast)] disabled:pointer-events-none disabled:opacity-40 [&_svg]:pointer-events-none [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        primary: 'bg-primary text-primary-foreground hover:bg-primary-hover active:bg-primary-active',
        outline: 'border border-input bg-transparent text-foreground hover:border-border-strong hover:bg-white/[0.05]',
        ghost: 'text-muted-foreground hover:bg-white/[0.06] hover:text-foreground',
        danger: 'border border-destructive/40 text-destructive hover:border-destructive/70 hover:bg-destructive/10',
        link: 'text-link underline-offset-4 hover:underline',
      },
      size: {
        sm: 'h-7 px-2.5 text-xs [&_svg]:size-3.5',
        md: 'h-8 px-3 text-[0.8125rem] [&_svg]:size-4',
        lg: 'h-10 px-4 text-sm [&_svg]:size-4',
        icon: 'h-8 w-8 [&_svg]:size-4',
        'icon-sm': 'h-7 w-7 [&_svg]:size-3.5',
      },
    },
    defaultVariants: { variant: 'outline', size: 'md' },
  }
);

function Button({ className, variant, size, asChild = false, ...props }) {
  const Comp = asChild ? Slot : 'button';
  return <Comp className={cn(buttonVariants({ variant, size, className }))} {...props} />;
}

export { Button, buttonVariants };
