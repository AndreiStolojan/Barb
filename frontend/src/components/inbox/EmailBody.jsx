// ─────────────────────────────────────────────────────────────────────────────
// EmailBody.jsx — renders the message itself, safely.
//
// Two safety layers, in order:
//   1. sanitizeEmailHtml() strips scripts/iframes/forms and (for risky buckets)
//      remote tracking images.
//   2. neutralizeLinks() below removes `href` from every anchor that survives.
//      This is a phishing tool: clicking a hostile link by accident must be
//      impossible, so nothing in the rendered body is ever navigable. The link
//      TEXT stays visible — and the real destination is preserved in the
//      tooltip and in `data-blocked-href` — because reading where a link
//      *claimed* to go is the whole point of the exercise.
//
// The rendered body never scrolls sideways: long words break, images and tables
// are capped at 100% by the `.email-body` rules, and anything still too wide is
// clipped rather than given a horizontal scrollbar.
// ─────────────────────────────────────────────────────────────────────────────

import { useMemo, useState } from 'react';
import { ImageOff } from 'lucide-react';

import { sanitizeEmailHtml } from '@/utils/sanitizeEmailHtml';

const RISKY = new Set(['needs_review', 'quarantine', 'confirmed_phishing']);

/**
 * Remove every usable `href` from the sanitized markup, keeping the visible
 * text. Returns HTML in which no anchor can navigate anywhere.
 */
export function neutralizeLinks(html) {
  if (typeof html !== 'string' || html.length === 0) return '';

  const documentNode = new DOMParser().parseFromString(html, 'text/html');

  for (const node of Array.from(documentNode.querySelectorAll('a[href], area[href]'))) {
    const href = node.getAttribute('href') || '';
    node.removeAttribute('href');
    // target/rel/ping only mean anything on a navigable anchor — drop them too
    // so nothing is left that could be re-armed by a stray script.
    node.removeAttribute('target');
    node.removeAttribute('rel');
    node.removeAttribute('ping');
    node.setAttribute('data-blocked-href', href);
    node.setAttribute('aria-disabled', 'true');
    node.setAttribute('title', `Link disabled for your safety — it points to ${href}`);
  }

  return documentNode.body.innerHTML;
}

/**
 * Render the email body safely. Prefers sanitized HTML, falls back to plain text.
 * For risky messages, remote images are blocked by default (tracking-pixel
 * protection) with a one-click "Load images" affordance; safe messages load them.
 */
export function EmailBody({ htmlBody, textBody, riskBucket }) {
  const [imagesLoaded, setImagesLoaded] = useState(false);
  const blockImages = RISKY.has(riskBucket) && !imagesLoaded;

  const { html, blockedImages } = useMemo(() => {
    const result = sanitizeEmailHtml(htmlBody, { blockImages });
    return { ...result, html: neutralizeLinks(result.html) };
  }, [htmlBody, blockImages]);

  if (html) {
    return (
      <div className="min-w-0 space-y-3">
        {blockImages && blockedImages > 0 && (
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[0.8125rem] text-muted-foreground-subtle">
            <ImageOff className="h-3.5 w-3.5 shrink-0" />
            <span>
              {blockedImages} remote image{blockedImages > 1 ? 's' : ''} blocked — they can tell
              the sender you opened this.
            </span>
            <button
              type="button"
              onClick={() => setImagesLoaded(true)}
              className="font-medium text-link underline-offset-2 transition-colors hover:underline"
            >
              Show images
            </button>
          </p>
        )}
        {/*
          Links are already href-less; the click guard is belt-and-braces. The
          dotted underline + default cursor say "this was a link, and it is
          switched off" without hiding the text.
        */}
        <div
          onClickCapture={(event) => {
            if (event.target?.closest?.('a, area')) event.preventDefault();
          }}
          className="email-body min-w-0 overflow-hidden [&_a]:cursor-default [&_a]:decoration-dotted [&_pre]:overflow-x-hidden [&_pre]:whitespace-pre-wrap [&_pre]:break-words"
          dangerouslySetInnerHTML={{ __html: html }}
        />
      </div>
    );
  }

  if (textBody) {
    return (
      <pre className="min-w-0 whitespace-pre-wrap break-words font-sans text-[0.96875rem] leading-[1.72] text-foreground/85">
        {textBody}
      </pre>
    );
  }

  return <p className="text-sm text-muted-foreground">This message has no readable content.</p>;
}
