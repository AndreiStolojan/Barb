import { Slot } from '@radix-ui/react-slot';
import { cva } from 'class-variance-authority';

import { cn } from '@/lib/utils';

/*
  One button. `primary` is the periwinkle action a screen may have once;
  `phish` is the coral "this is phishing" verdict; everything else is an
  outline or a ghost so the hierarchy stays readable.
*/
const buttonVariants = cva(
  'focus-ring inline-flex shrink-0 select-none items-center justify-center gap-2 whitespace-nowrap rounded-lg font-medium transition-[background-color,box-shadow,color,opacity] duration-[var(--duration-fast)] disabled:pointer-events-none disabled:opacity-40 [&_svg]:pointer-events-none [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        primary: 'bg-primary text-primary-foreground hover:bg-primary-hover active:bg-primary-active',
        phish: 'bg-risk-quarantine text-[#2b100b] hover:brightness-110',
        outline: 'text-foreground shadow-[inset_0_0_0_1px_var(--color-border-strong)] hover:bg-white/[0.05]',
        ghost: 'text-muted-foreground hover:bg-white/[0.06] hover:text-foreground',
        danger: 'text-destructive shadow-[inset_0_0_0_1px_rgb(241_103_125_/_0.4)] hover:bg-destructive/10',
        link: 'text-link underline-offset-4 hover:underline',
      },
      size: {
        sm: 'h-8 px-3 text-[0.8125rem] [&_svg]:size-4',
        md: 'h-9 px-3.5 text-sm [&_svg]:size-4',
        lg: 'h-10 px-[1.125rem] text-sm [&_svg]:size-4',
        icon: 'h-9 w-9 rounded-[0.625rem] [&_svg]:size-[18px]',
        'icon-sm': 'h-8 w-8 [&_svg]:size-4',
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
