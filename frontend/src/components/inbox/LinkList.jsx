// The URLs found in a message, shown safely: nothing here is clickable, long
// URLs are clipped, and every row can copy the full string for a scanner or a
// ticket.

import { useEffect, useRef, useState } from 'react';
import { Check, Copy } from 'lucide-react';

const MAX_URL = 72;

export const truncateUrl = (url, max = MAX_URL) => (url.length > max ? `${url.slice(0, max)}…` : url);

const toUrl = (link) => (typeof link === 'string' ? link : link?.url || link?.href || '');

const hostOf = (url) => {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
};

export function LinkList({ links, flaggedHosts = new Set() }) {
  const [copied, setCopied] = useState(null);
  const timer = useRef(null);

  useEffect(() => () => clearTimeout(timer.current), []);

  const copy = async (url, key) => {
    try {
      await navigator.clipboard?.writeText(url);
      setCopied(key);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(null), 1600);
    } catch {
      // Clipboard blocked: the full URL is still in the tooltip.
    }
  };

  if (links.length === 0) {
    return <p className="text-sm text-muted-foreground">No links.</p>;
  }

  return (
    <ul className="divide-y divide-border">
      {links.map((link, i) => {
        const url = toUrl(link);
        const host = hostOf(url);
        const flagged = flaggedHosts.has(host);
        return (
          <li key={`${url}-${i}`} className="flex min-w-0 items-center gap-3 py-2">
            <span aria-hidden="true" className={flagged ? 'h-1.5 w-1.5 shrink-0 rounded-full bg-risk-quarantine' : 'h-1.5 w-1.5 shrink-0 rounded-full bg-white/[0.18]'} />
            <span title={url} className="min-w-0 flex-1 truncate text-sm text-muted-foreground">
              {truncateUrl(url)}
            </span>
            <button
              type="button"
              onClick={() => copy(url, i)}
              aria-label={`Copy link ${url}`}
              className="focus-ring flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1 text-[0.8125rem] text-muted-foreground-subtle transition-colors hover:text-foreground"
            >
              {copied === i ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
              {copied === i ? 'Copied' : 'Copy'}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
