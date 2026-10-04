// ─────────────────────────────────────────────────────────────────────────────
// EmailRow.jsx — one row of the message list.
//
// Evidence before decoration, top to bottom: sender name and time, the sender
// ADDRESS (in triage the address is the evidence, so it is never hidden),
// the subject, then score meter + score + verdict.
//
// Modes: a link to /inbox/:id (deep links), a button that selects into the
// pane (`onSelect`), and the same button beside a checkbox (`checkable`).
// ─────────────────────────────────────────────────────────────────────────────

import { Link } from 'react-router-dom';

import { ScoreMeter } from '@/components/inbox/ScoreMeter';
import { emailId, getSenderAddress, getSenderName } from '@/lib/email';
import { getRiskMeta } from '@/lib/risk';
import { getRiskTextColor, isScored } from '@/lib/scoreScale';
import { formatRowTime } from '@/utils/formatDate';
import { cn } from '@/lib/utils';

export function EmailRow({ email, active = false, onSelect = null, checkable = false, checked = false, onCheck = null }) {
  const id = emailId(email);
  const { label, tone } = getRiskMeta(email.riskBucket);
  const score = email.latestScan?.score ?? null;
  const scored = isScored(score);
  const name = getSenderName(email);
  const address = getSenderAddress(email);
  const showAddress = Boolean(address) && address !== name;

  const className = cn(
    'focus-ring group grid w-full min-w-0 grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-3 gap-y-[2px] border-l-2 py-2.5 pr-4 text-left transition-colors',
    checkable ? 'pl-2' : 'pl-[14px]',
    active ? 'border-l-primary bg-white/[0.07]' : 'border-l-transparent',
    !active && !checkable && 'hover:bg-white/[0.04]'
  );

  const content = (
    <>
      <span className={cn('truncate text-[0.8125rem] font-medium', active ? 'text-foreground' : 'text-foreground/90')}>{name}</span>
      <time className="data shrink-0 text-[0.6875rem] text-muted-foreground">{formatRowTime(email.receivedAt)}</time>

      {showAddress && <span className="data col-span-2 truncate text-[0.6875rem] text-muted-foreground">{address}</span>}

      <span className={cn('col-span-2 truncate text-[0.8125rem]', active ? 'text-foreground/90' : 'text-foreground/70')}>
        {email.subject || '(no subject)'}
      </span>

      <span className="col-span-2 mt-1 flex min-w-0 items-center gap-2">
        <ScoreMeter score={score} className="w-12" />
        <span
          className={cn('data w-5 shrink-0 text-right text-[0.6875rem] font-medium', !scored && 'text-muted-foreground-subtle')}
          style={scored ? { color: getRiskTextColor(score) } : undefined}
        >
          {scored ? score : '–'}
        </span>
        <span className={cn('flex min-w-0 items-center gap-1.5 text-[0.6875rem]', tone.text)}>
          <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', tone.dot)} />
          <span className="truncate">{label}</span>
        </span>
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
      <div className={cn('flex min-w-0 items-start gap-1 pl-3 transition-colors hover:bg-white/[0.04]', checked && 'bg-white/[0.05]')}>
        <input
          type="checkbox"
          checked={checked}
          onChange={() => onCheck?.(id)}
          aria-label={`Select ${email.subject || 'message'}`}
          className="mt-3.5 h-3.5 w-3.5 shrink-0 accent-primary"
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
