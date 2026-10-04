// ─────────────────────────────────────────────────────────────────────────────
// EmailRow.jsx — one row of the message list.
//
// Avatar, sender, time, subject. A risk pill appears ONLY when there is
// something to say: a safe message carries no label at all, so the few that
// are flagged stand out on their own. The selected row takes the panel colour,
// so it reads as the message the panel beside it is showing.
//
// Modes: a link to /inbox/:id (deep links), a button that selects into the
// pane (`onSelect`), and the same button beside a checkbox (`checkable`).
// ─────────────────────────────────────────────────────────────────────────────

import { Link } from 'react-router-dom';

import { initials } from '@/components/layout/Rail';
import { emailId, getSenderAddress, getSenderName } from '@/lib/email';
import { getRiskMeta } from '@/lib/risk';
import { formatRowTime } from '@/utils/formatDate';
import { cn } from '@/lib/utils';

// Buckets quiet enough to need no pill in the list.
const QUIET = new Set(['safe', 'reviewed_safe']);

/* The small coloured label used in lists. */
export function RiskPill({ bucket, className }) {
  const { label, tone } = getRiskMeta(bucket);
  return (
    <span className={cn('inline-flex items-center gap-1.5 rounded-full py-0.5 pl-[7px] pr-2.5 text-xs font-medium', tone.text, tone.softBg, className)}>
      <span className={cn('h-1.5 w-1.5 rounded-full', tone.dot)} />
      {label}
    </span>
  );
}

export function Avatar({ name, size = 'md', className }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'flex shrink-0 items-center justify-center rounded-full bg-white/[0.08] font-semibold text-muted-foreground',
        size === 'sm' && 'h-7 w-7 text-[0.6875rem]',
        size === 'md' && 'h-9 w-9 text-[0.8125rem]',
        size === 'lg' && 'h-[42px] w-[42px] text-sm',
        className
      )}
    >
      {initials(name)}
    </span>
  );
}

export function EmailRow({ email, active = false, onSelect = null, checkable = false, checked = false, onCheck = null }) {
  const id = emailId(email);
  const name = getSenderName(email);
  const address = getSenderAddress(email);
  const flagged = !QUIET.has(email.riskBucket);

  const className = cn(
    'focus-ring grid w-full min-w-0 grid-cols-[2.25rem_minmax(0,1fr)] gap-3 rounded-[0.875rem] p-3 text-left transition-colors duration-[var(--duration-fast)]',
    active ? 'bg-panel' : 'hover:bg-white/[0.035]'
  );

  const content = (
    <>
      <Avatar name={name || address} />
      <span className="min-w-0">
        <span className="flex items-baseline justify-between gap-3">
          <span className="truncate text-[0.90625rem] font-semibold">{name}</span>
          <time className="data shrink-0 text-xs text-muted-foreground-subtle">{formatRowTime(email.receivedAt)}</time>
        </span>
        <span className="mt-px block truncate text-sm text-muted-foreground">{email.subject || '(no subject)'}</span>
        {flagged && <RiskPill bucket={email.riskBucket} className="mt-2" />}
      </span>
    </>
  );

  if (onSelect) {
    const button = (
      <button type="button" onClick={() => onSelect(id)} aria-current={active ? 'true' : undefined} className={className}>
        {content}
      </button>
    );
    if (!checkable) return button;
    return (
      <div className="flex min-w-0 items-start gap-1 pl-2">
        <input
          type="checkbox"
          checked={checked}
          onChange={() => onCheck?.(id)}
          aria-label={`Select ${email.subject || 'message'}`}
          className="mt-5 h-4 w-4 shrink-0 accent-[var(--color-primary)]"
        />
        {button}
      </div>
    );
  }

  return (
    <Link to={`/inbox/${id}`} className={className}>
      {content}
    </Link>
  );
}
