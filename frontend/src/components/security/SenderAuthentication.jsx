// ─────────────────────────────────────────────────────────────────────────────
// SenderAuthentication.jsx — did this message really come from who it claims?
//
// Three short lines: sending server (SPF), signature (DKIM), domain policy
// (DMARC). Each is passed, failed, or not verified, and the three never look
// alike: a check we could not run is not drawn like one that failed, because
// that would invent an accusation. The full sentence for each is the tooltip.
// ─────────────────────────────────────────────────────────────────────────────

import { Check, Minus, X } from 'lucide-react';

import { getSenderAuthentication } from '@/lib/senderAuth';
import { cn } from '@/lib/utils';

const STATE = {
  pass: { icon: Check, className: 'bg-risk-safe-soft text-risk-safe', srLabel: 'Passed' },
  fail: { icon: X, className: 'bg-risk-quarantine-soft text-risk-quarantine', srLabel: 'Failed' },
  unknown: { icon: Minus, className: 'bg-white/[0.07] text-muted-foreground-subtle', srLabel: 'Not verified' },
};

// The short status word, per mechanism. 'none' means the sender published
// nothing to check against, which is different from "we could not check".
const STATUS = {
  spf: { pass: 'Authorised', fail: 'Not authorised', none: 'No policy', unknown: 'Not checked' },
  dkim: { pass: 'Valid', fail: 'Invalid', none: 'Not signed', unknown: 'Not checked' },
  dmarc: { pass: 'Passed', fail: 'Failed', none: 'No policy', unknown: 'Not checked' },
};

const statusWord = (id, state, raw) => {
  if (state !== 'unknown') return STATUS[id][state];
  return String(raw || '').toLowerCase() === 'none' ? STATUS[id].none : STATUS[id].unknown;
};

export function SenderAuthentication({ authResults, className }) {
  const { available, summary, mechanisms } = getSenderAuthentication(authResults);

  if (!available) {
    return <p className={cn('text-sm text-muted-foreground', className)}>{summary}</p>;
  }

  return (
    <div className={cn('min-w-0', className)}>
      {mechanisms.map(({ id, label, state, description }) => {
        const tone = STATE[state] ?? STATE.unknown;
        const Icon = tone.icon;
        return (
          <div key={id} title={description} className="grid grid-cols-[22px_minmax(0,1fr)_auto] items-center gap-3 py-[7px] text-[0.9375rem]">
            <span className={cn('flex h-[22px] w-[22px] items-center justify-center rounded-full', tone.className)}>
              <Icon className="h-3 w-3" strokeWidth={2.5} aria-hidden="true" />
            </span>
            <span>
              {label}
              <span className="sr-only">: {tone.srLabel}. {description}</span>
            </span>
            <span className="text-[0.8125rem] text-muted-foreground-subtle">{statusWord(id, state, authResults?.[id]?.result)}</span>
          </div>
        );
      })}
    </div>
  );
}

export default SenderAuthentication;
