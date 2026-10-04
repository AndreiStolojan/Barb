// ─────────────────────────────────────────────────────────────────────────────
// SenderAuthentication.jsx — did this message really come from who it claims?
//
// Three mechanisms (sending server, signature, domain policy), each in one of
// THREE states: passed, failed, or not verified. A check we could not run is
// never drawn like a check that failed: that would invent an accusation.
// ARC and the published DMARC policy are listed as facts underneath.
// ─────────────────────────────────────────────────────────────────────────────

import { Check, Minus, X } from 'lucide-react';

import { getSenderAuthentication } from '@/lib/senderAuth';
import { cn } from '@/lib/utils';

const STATE = {
  pass: { icon: Check, color: 'var(--color-risk-safe)', srLabel: 'Passed', word: 'pass' },
  fail: { icon: X, color: 'var(--color-risk-quarantine)', srLabel: 'Failed', word: 'fail' },
  unknown: { icon: Minus, color: 'var(--color-risk-unscanned)', srLabel: 'Not verified', word: 'not verified' },
};

const MECHANISM_CODE = { spf: 'SPF', dkim: 'DKIM', dmarc: 'DMARC' };

function Mechanism({ id, label, state, description }) {
  const tone = STATE[state] ?? STATE.unknown;
  const Icon = tone.icon;
  return (
    <div className="grid grid-cols-[1.25rem_minmax(0,1fr)_auto] items-start gap-x-3 border-b border-border py-2.5 last:border-b-0">
      <span className="flex h-5 w-5 items-center justify-center rounded-full border" style={{ borderColor: tone.color, color: tone.color }}>
        <Icon className="h-3 w-3" aria-hidden="true" strokeWidth={2.5} />
      </span>
      <div className="min-w-0">
        <p className="text-[0.8125rem] font-medium">
          {label}
          <span className="sr-only">: {tone.srLabel}</span>
        </p>
        <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{description}</p>
      </div>
      <span className="data text-[0.6875rem]" style={{ color: tone.color }}>
        {MECHANISM_CODE[id]} {tone.word}
      </span>
    </div>
  );
}

export function SenderAuthentication({ authResults, className }) {
  const { available, tone, summary, mechanisms } = getSenderAuthentication(authResults);
  const arc = authResults?.arc?.result;
  const policy = authResults?.dmarc?.policy;

  if (!available) {
    return <p className={cn('text-[0.8125rem] text-muted-foreground', className)}>{summary}</p>;
  }

  return (
    <div className={cn('min-w-0', className)}>
      <p className="text-[0.8125rem] font-medium" style={{ color: STATE[tone]?.color }}>
        {summary}
      </p>
      <div className="mt-1">
        {mechanisms.map((m) => (
          <Mechanism key={m.id} {...m} />
        ))}
      </div>
      <dl className="mt-3 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 text-xs">
        <dt className="text-muted-foreground">Domain policy</dt>
        <dd className="data">{policy ? `p=${policy}` : 'none published'}</dd>
        <dt className="text-muted-foreground">Forwarding chain (ARC)</dt>
        <dd className="data">{arc && arc !== 'none' ? arc : 'not present'}</dd>
      </dl>
    </div>
  );
}

export default SenderAuthentication;
