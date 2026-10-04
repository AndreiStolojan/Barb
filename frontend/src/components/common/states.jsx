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
      <Loader2 className="h-5 w-5 animate-spin text-muted-foreground-subtle" />
      <p className="text-sm text-muted-foreground">{label}</p>
    </div>
  );
}

export function ErrorState({ message, onRetry, className }) {
  return (
    <div role="alert" className={cn('flex flex-col items-center justify-center gap-4 px-6 py-14 text-center', className)}>
      <AlertTriangle className="h-5 w-5 text-destructive" />
      <div className="space-y-1">
        <p className="text-[0.9375rem] font-medium">Could not load this</p>
        <p className="mx-auto max-w-sm text-sm text-muted-foreground">
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
        {title && <p className="text-[0.9375rem] font-medium">{title}</p>}
        {description && <p className="mx-auto max-w-[32ch] text-sm leading-relaxed text-muted-foreground">{description}</p>}
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
  ['Connect your Gmail', 'SecureInbox reads your mail and never sends from your account. Marking a message as phishing moves it to Spam.'],
  ['Every message is checked', 'Who sent it, where its links go, what it attaches, and how it is worded.'],
  ['You decide on the few that matter', 'Each flagged message shows why, so the call takes seconds.'],
];

/*
  First run. Shown by the briefing and the inbox while no mailbox is connected.
  Three steps, one button. The steps are a sequence, so they are numbered.
*/
export function ConnectGmailState({ compact = false }) {
  return (
    <div className={cn('mx-auto w-full max-w-xl px-6', compact ? 'py-10' : 'py-16 md:py-24')}>
      <h2 className="text-h1 font-medium">Connect Gmail to begin</h2>
      <p className="mt-2 max-w-md text-[0.9375rem] leading-relaxed text-muted-foreground">
        SecureInbox reads your inbox, checks every message, and shows you only what needs a decision.
      </p>

      <ol className="mt-8 grid gap-5">
        {STEPS.map(([title, body], i) => (
          <li key={title} className="grid grid-cols-[2rem_minmax(0,1fr)] gap-3.5">
            <span className="data flex h-8 w-8 items-center justify-center rounded-full bg-white/[0.07] text-sm text-muted-foreground">{i + 1}</span>
            <div>
              <p className="text-[0.9375rem] font-medium">{title}</p>
              <p className="mt-0.5 text-sm leading-relaxed text-muted-foreground">{body}</p>
            </div>
          </li>
        ))}
      </ol>

      <div className="mt-9">
        <ConnectGmailButton size="lg" />
      </div>
    </div>
  );
}

/* ── Skeletons ───────────────────────────────────────────────────────────── */

export function ListSkeleton({ rows = 7 }) {
  const widths = ['w-28', 'w-36', 'w-24', 'w-40', 'w-32', 'w-28', 'w-36'];
  return (
    <div role="status" aria-label="Loading messages" className="grid gap-1 px-1 pt-2">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="grid grid-cols-[2.25rem_minmax(0,1fr)] gap-3 p-3">
          <Skeleton className="h-9 w-9 rounded-full" />
          <div className="space-y-2 pt-1">
            <div className="flex justify-between">
              <Skeleton className={cn('h-3', widths[i % widths.length])} />
              <Skeleton className="h-3 w-9" />
            </div>
            <Skeleton className="h-3 w-4/5" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function BriefingSkeleton() {
  return (
    <div role="status" aria-label="Loading briefing" className="space-y-10">
      <div className="space-y-3">
        <Skeleton className="h-8 w-72 rounded-lg" />
        <Skeleton className="h-3.5 w-64 max-w-full" />
      </div>
      <div className="grid gap-4 lg:grid-cols-[1.45fr_1fr]">
        <Skeleton className="h-52 rounded-[1.25rem]" />
        <Skeleton className="h-52 rounded-[1.25rem]" />
      </div>
      <Skeleton className="h-48 rounded-[1.25rem]" />
    </div>
  );
}
