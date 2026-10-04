// ─────────────────────────────────────────────────────────────────────────────
// EmailBody.jsx — renders the message itself, safely and as it was designed.
//
// Two safety layers, in order:
//   1. sanitizeEmailHtml() strips scripts, styles, media and (for risky
//      buckets) every remote image.
//   2. neutralizeLinks() removes `href` from every anchor that survives, so
//      nothing in the body is navigable. The link TEXT stays visible and the
//      real destination stays in the tooltip and `data-blocked-href`.
//
// How it is shown:
//   - HTML mail is laid out on a light "paper" sheet, because senders design
//     for a white background: on the dark app, dark text on a transparent
//     email became unreadable.
//   - The sheet keeps the email's own width (newsletters are usually 600px
//     tables) and is scaled down with CSS `zoom` until it fits, the way mail
//     apps do on a phone. Squeezing the tables to the screen instead clipped
//     the right side of every fixed-width message.
//   - Plain-text mail stays in the app's own type and colours.
// ─────────────────────────────────────────────────────────────────────────────

import { useLayoutEffect, useMemo, useRef, useState } from 'react';
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

/*
  Scale the sheet so its natural width fits the space it has. Measured after
  layout and again whenever the space or the content's size changes (images
  arriving, the window resizing, the phone rotating).
*/
function useFitToWidth(outerRef, innerRef, deps) {
  useLayoutEffect(() => {
    const outer = outerRef.current;
    const inner = innerRef.current;
    if (!outer || !inner) return undefined;

    let frame = 0;
    const fit = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        // At zoom 1 the sheet's own box is the space available; anything wider
        // is the email's fixed layout spilling out of it.
        inner.style.zoom = '1';
        const natural = inner.scrollWidth;
        const available = inner.clientWidth;
        inner.style.zoom = natural > available + 1 && available > 0 ? String(available / natural) : '1';
      });
    };

    fit();
    if (typeof ResizeObserver === 'undefined') return () => cancelAnimationFrame(frame);
    const observer = new ResizeObserver(fit);
    observer.observe(outer);
    for (const img of Array.from(inner.querySelectorAll('img'))) img.addEventListener('load', fit, { once: true });
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

/**
 * Render the email body safely. Prefers sanitized HTML, falls back to plain text.
 * For risky messages, remote images are blocked by default (tracking-pixel
 * protection) with a one-click "Show images" control; safe messages load them.
 */
export function EmailBody({ htmlBody, textBody, riskBucket }) {
  const [imagesLoaded, setImagesLoaded] = useState(false);
  const blockImages = RISKY.has(riskBucket) && !imagesLoaded;
  const outerRef = useRef(null);
  const innerRef = useRef(null);

  const { html, blockedImages } = useMemo(() => {
    const result = sanitizeEmailHtml(htmlBody, { blockImages });
    return { ...result, html: neutralizeLinks(result.html) };
  }, [htmlBody, blockImages]);

  useFitToWidth(outerRef, innerRef, [html]);

  if (html) {
    return (
      <div className="min-w-0 space-y-3">
        {blockImages && blockedImages > 0 && (
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[0.8125rem] text-muted-foreground-subtle">
            <ImageOff className="h-3.5 w-3.5 shrink-0" />
            <span>
              {blockedImages} remote image{blockedImages > 1 ? 's' : ''} blocked. They can tell
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
        {/* The paper sheet. Links are already href-less; the click guard is
            belt-and-braces. */}
        <div ref={outerRef} className="min-w-0 overflow-hidden rounded-xl bg-[#fbfbfa] p-4 sm:p-6">
          <div
            ref={innerRef}
            data-testid="email-html"
            onClickCapture={(event) => {
              if (event.target?.closest?.('a, area')) event.preventDefault();
            }}
            className="email-body email-paper min-w-0 [&_a]:cursor-default [&_pre]:whitespace-pre-wrap [&_pre]:break-words"
            dangerouslySetInnerHTML={{ __html: html }}
          />
        </div>
      </div>
    );
  }

  if (textBody) {
    return (
      <pre className="min-w-0 max-w-[68ch] whitespace-pre-wrap break-words font-sans text-[0.96875rem] leading-[1.72] text-foreground/85">
        {textBody}
      </pre>
    );
  }

  return <p className="text-sm text-muted-foreground">This message has no readable content.</p>;
}
