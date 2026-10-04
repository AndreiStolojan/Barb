import { cn } from '@/lib/utils';

/* Text input: a soft hairline that brightens on hover and focus. */
const fieldClass =
  'focus-ring w-full min-w-0 rounded-[0.625rem] bg-white/[0.03] px-3 text-sm text-foreground caret-primary shadow-[inset_0_0_0_1px_var(--color-input)] transition-[box-shadow,background-color] duration-[var(--duration-fast)] placeholder:text-muted-foreground-subtle hover:shadow-[inset_0_0_0_1px_var(--color-border-strong)] disabled:cursor-not-allowed disabled:opacity-50';

function Input({ className, type = 'text', ...props }) {
  return <input type={type} className={cn(fieldClass, 'flex h-9', className)} {...props} />;
}

function Textarea({ className, ...props }) {
  return <textarea className={cn(fieldClass, 'flex min-h-24 py-2.5 leading-relaxed', className)} {...props} />;
}

export { Input, Textarea };
