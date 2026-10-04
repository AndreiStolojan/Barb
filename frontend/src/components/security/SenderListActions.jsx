// ─────────────────────────────────────────────────────────────────────────────
// SenderListActions.jsx — Trust / Block for the sender of the open message.
//
// The exact address and its whole domain are managed independently; a sender
// rule beats a domain rule at scan time, so contradictory pairs are not
// offered. Rules apply to the next scan, which is why the parent prompts for
// a rescan after a change.
// ─────────────────────────────────────────────────────────────────────────────

import { useState } from 'react';
import { toast } from 'sonner';
import { ChevronDown, Loader2, ShieldCheck, ShieldOff, UserRoundCheck, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { addSenderListEntry, removeSenderListEntry } from '@/api/senderListsApi';
import { normalizeAddress, normalizeDomain } from '@/lib/senderLists';
import { cn } from '@/lib/utils';

export function SenderListActions({ senderAddress, senderDomain, senderEntry, domainEntry, onChanged }) {
  const [busy, setBusy] = useState(false);
  const address = normalizeAddress(senderAddress);
  const domain = normalizeDomain(senderDomain);
  const match = senderEntry || domainEntry;

  const run = async (action, message) => {
    setBusy(true);
    try {
      await action();
      onChanged?.(message);
    } catch (e) {
      toast.error(e.message || 'Could not update the list.');
    } finally {
      setBusy(false);
    }
  };

  const addEntry = (listType, kind, value) =>
    run(() => addSenderListEntry({ listType, kind, value }), `${kind === 'sender' ? 'Sender' : 'Domain'} ${listType === 'allow' ? 'trusted' : 'blocked'}.`);
  const removeEntry = (entry) =>
    run(() => removeSenderListEntry(entry.id), `Removed from ${entry.listType === 'allow' ? 'trusted' : 'blocked'}.`);

  if (!address && !domain) return null;

  const label = match ? (match.listType === 'allow' ? 'Trusted' : 'Blocked') : 'Trust or block';
  const Icon = match ? (match.listType === 'allow' ? ShieldCheck : ShieldOff) : UserRoundCheck;
  const scope = match ? (match.kind === 'domain' ? 'domain' : 'sender') : null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          disabled={busy}
          className={cn(match?.listType === 'allow' && 'text-risk-safe hover:text-risk-safe', match?.listType === 'block' && 'text-risk-quarantine hover:text-risk-quarantine')}
        >
          {busy ? <Loader2 className="animate-spin" /> : <Icon />}
          {label}
          {scope && <span className="opacity-70">{scope}</span>}
          <ChevronDown className="opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        {address && (
          <>
            <DropdownMenuLabel className="truncate">{address}</DropdownMenuLabel>
            {senderEntry ? (
              <DropdownMenuItem onClick={() => removeEntry(senderEntry)}>
                <X />
                Remove from {senderEntry.listType === 'allow' ? 'trusted' : 'blocked'}
              </DropdownMenuItem>
            ) : domainEntry ? (
              <p className="px-2.5 py-1.5 text-[0.8125rem] text-muted-foreground">
                Already {domainEntry.listType === 'allow' ? 'trusted' : 'blocked'} through the domain rule below.
              </p>
            ) : (
              <>
                <DropdownMenuItem onClick={() => addEntry('allow', 'sender', address)}>
                  <ShieldCheck className="text-risk-safe" />
                  Trust this sender
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => addEntry('block', 'sender', address)}>
                  <ShieldOff className="text-risk-quarantine" />
                  Block this sender
                </DropdownMenuItem>
              </>
            )}
          </>
        )}
        {address && domain && <DropdownMenuSeparator />}
        {domain && (
          <>
            <DropdownMenuLabel className="truncate">{domain}</DropdownMenuLabel>
            {domainEntry ? (
              <DropdownMenuItem onClick={() => removeEntry(domainEntry)}>
                <X />
                Remove from {domainEntry.listType === 'allow' ? 'trusted' : 'blocked'}
              </DropdownMenuItem>
            ) : (
              <>
                {senderEntry?.listType !== 'block' && (
                  <DropdownMenuItem onClick={() => addEntry('allow', 'domain', domain)}>
                    <ShieldCheck className="text-risk-safe" />
                    Trust the whole domain
                  </DropdownMenuItem>
                )}
                {senderEntry?.listType !== 'allow' && (
                  <DropdownMenuItem onClick={() => addEntry('block', 'domain', domain)}>
                    <ShieldOff className="text-risk-quarantine" />
                    Block the whole domain
                  </DropdownMenuItem>
                )}
              </>
            )}
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
