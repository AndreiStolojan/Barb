import { cn } from '@/lib/utils';

/* Text input. Transparent on the canvas, a hairline that brightens on focus. */
function Input({ className, type = 'text', ...props }) {
  return (
    <input
      type={type}
      className={cn(
        'focus-ring flex h-8 w-full min-w-0 rounded-md border border-input bg-transparent px-2.5 text-[0.8125rem] text-foreground caret-foreground transition-[border-color] duration-[var(--duration-fast)]',
        'placeholder:text-muted-foreground-subtle hover:border-border-strong focus-visible:border-border-strong',
        'disabled:cursor-not-allowed disabled:opacity-50',
        className
      )}
      {...props}
    />
  );
}

/* Multi-line variant with the same skin. */
function Textarea({ className, ...props }) {
  return (
    <textarea
      className={cn(
        'focus-ring flex min-h-20 w-full rounded-md border border-input bg-transparent px-2.5 py-2 text-[0.8125rem] leading-relaxed text-foreground caret-foreground transition-[border-color] duration-[var(--duration-fast)]',
        'placeholder:text-muted-foreground-subtle hover:border-border-strong focus-visible:border-border-strong',
        'disabled:cursor-not-allowed disabled:opacity-50',
        className
      )}
      {...props}
    />
  );
}

export { Input, Textarea };
