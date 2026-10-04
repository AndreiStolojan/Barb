// Shared status screens: loading, error, empty, and the first-run "connect
// Gmail" screen. Each one is a direction, not a mood: what happened and what
// to do next.

import { AlertTriangle, Link2, Loader2, RotateCw } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useAsyncAction } from '@/hooks/useAsyncAction';
import { getGoogleConnectUrl } from '@/api/mailAccountsApi';
import { cn } from '@/lib/utils';

export function LoadingState({ label = 'Loading…', className }) {
  return (
    <div role="status" aria-live="polite" className={cn('flex flex-col items-center justify-center gap-3 py-16 text-center', className)}>
      <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  );
}

export function ErrorState({ message, onRetry, className }) {
  return (
    <div role="alert" className={cn('flex flex-col items-center justify-center gap-4 px-6 py-14 text-center', className)}>
      <AlertTriangle className="h-5 w-5 text-destructive" />
      <div className="space-y-1">
        <p className="text-sm font-semibold">Could not load this</p>
        <p className="mx-auto max-w-sm text-xs text-muted-foreground">
          {message || 'The server did not respond. It may be offline; try again in a moment.'}
        </p>
      </div>
      {onRetry && (
        <Button size="sm" onClick={onRetry}>
          <RotateCw />
          Try again
        </Button>
      )}
    </div>
  );
}

export function EmptyState({ icon: Icon, title, description, action, className }) {
  return (
    <div className={cn('flex flex-col items-center justify-center gap-3 px-6 py-14 text-center', className)}>
      {Icon && <Icon className="h-5 w-5 text-muted-foreground-subtle" strokeWidth={1.5} />}
      <div className="space-y-1">
        {title && <p className="text-sm font-semibold">{title}</p>}
        {description && <p className="mx-auto max-w-sm text-xs leading-relaxed text-muted-foreground">{description}</p>}
      </div>
      {action}
    </div>
  );
}

/* Starts the Google OAuth flow. Used on the first-run screen and in Settings. */
export function ConnectGmailButton({ size = 'md', className, children = 'Connect Gmail' }) {
  const connect = useAsyncAction(async () => {
    const result = await getGoogleConnectUrl();
    const url = result?.authUrl || result?.url;
    if (!url) throw new Error('Google sign-in is not configured on this server.');
    window.location.href = url;
  });

  return (
    <Button
      variant="primary"
      size={size}
      className={className}
      disabled={connect.loading}
      onClick={() => connect.run().catch((e) => toast.error(e.message || 'Could not start the Google sign-in.'))}
    >
      {connect.loading ? <Loader2 className="animate-spin" /> : <Link2 />}
      {children}
    </Button>
  );
}

const STEPS = [
  ['Connect your Gmail', 'Read-only access to your inbox through Google. SecureInbox never sends mail on your behalf.'],
  ['Every message gets scanned', 'Sender identity, links, attachments, deterministic rules and a bounded local AI signal.'],
  ['You review what was flagged', 'Each verdict comes with its evidence. Mark a message safe or phishing, and the inbox learns.'],
];

/*
  First run. Shown by the briefing and the inbox while no mailbox is connected.
  Three steps, one button. The steps are a sequence, so they are numbered.
*/
export function ConnectGmailState({ compact = false }) {
  return (
    <div className={cn('mx-auto w-full max-w-xl px-6', compact ? 'py-10' : 'py-20')}>
      <p className="text-h1 font-semibold">Nothing to review yet</p>
      <p className="mt-2 max-w-md text-[0.8125rem] leading-relaxed text-muted-foreground">
        SecureInbox works on a connected Gmail inbox. Three steps, and the first one is yours.
      </p>

      <ol className="mt-8 grid gap-5">
        {STEPS.map(([title, body], i) => (
          <li key={title} className="grid grid-cols-[1.75rem_minmax(0,1fr)] gap-3">
            <span className="data flex h-7 w-7 items-center justify-center rounded-full border border-border-strong text-xs text-muted-foreground">
              {i + 1}
            </span>
            <div>
              <p className="text-sm font-medium">{title}</p>
              <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{body}</p>
            </div>
          </li>
        ))}
      </ol>

      <div className="mt-8">
        <ConnectGmailButton size="lg" />
      </div>
    </div>
  );
}

/* ── Skeletons ───────────────────────────────────────────────────────────── */

export function ListSkeleton({ rows = 8 }) {
  const widths = ['w-28', 'w-40', 'w-32', 'w-44', 'w-36', 'w-40', 'w-28', 'w-48'];
  return (
    <div role="status" aria-label="Loading messages" className="divide-y divide-border">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="space-y-2 px-4 py-3">
          <div className="flex items-center justify-between">
            <Skeleton className={cn('h-3', widths[i % widths.length])} />
            <Skeleton className="h-3 w-10" />
          </div>
          <Skeleton className="h-3 w-3/4" />
          <Skeleton className="h-2.5 w-20" />
        </div>
      ))}
    </div>
  );
}

export function BriefingSkeleton() {
  return (
    <div role="status" aria-label="Loading briefing" className="space-y-10">
      <div className="space-y-3">
        <Skeleton className="h-7 w-72" />
        <Skeleton className="h-3 w-96 max-w-full" />
      </div>
      <div className="grid grid-cols-2 gap-6 md:grid-cols-5">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="space-y-2">
            <Skeleton className="h-8 w-14" />
            <Skeleton className="h-2.5 w-20" />
          </div>
        ))}
      </div>
      <div className="space-y-px">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="flex items-center gap-4 border-b border-border py-3">
            <Skeleton className="h-3 w-40" />
            <Skeleton className="h-3 flex-1" />
            <Skeleton className="h-3 w-8" />
          </div>
        ))}
      </div>
      <Skeleton className="h-44 w-full" />
    </div>
  );
}
