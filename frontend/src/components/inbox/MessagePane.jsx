// ─────────────────────────────────────────────────────────────────────────────
// MessagePane.jsx — one message, read on the raised panel.
//
// Top to bottom, and why:
//   1. Who sent it and what it says it is: sender, address, time, subject.
//   2. The verdict card: score ring, verdict, one sentence, the two decisions.
//      The only tinted surface on the screen.
//   3. Why it was flagged (the reasons) beside the sender check (SPF, DKIM,
//      DMARC as three short lines). Enough to decide without scrolling.
//   4. The message itself, in a recessed well, links disabled.
//   5. Scoring details, folded: the score breakdown, every rule that fired,
//      the AI reading, the links, and the scan and Gmail facts. Nothing is
//      hidden from the audit trail; it just does not compete with the decision.
//
// Data: getEmail (detail + state), getEmailRaw (body, links), getLatestScan
// (score, reasons, rules, AI metadata), getSenderLists (trust/block state).
// ─────────────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, ArrowLeft, ChevronDown, ChevronRight, ChevronUp, Loader2, Lock, Paperclip, RotateCw } from 'lucide-react';
import { toast } from 'sonner';

import { ErrorState, LoadingState } from '@/components/common/states';
import { Avatar } from '@/components/inbox/EmailRow';
import { EmailBody } from '@/components/inbox/EmailBody';
import { LinkList } from '@/components/inbox/LinkList';
import { ScoreMeter } from '@/components/inbox/ScoreMeter';
import { ReviewActions } from '@/components/security/ReviewActions';
import { SenderAuthentication } from '@/components/security/SenderAuthentication';
import { SenderListActions } from '@/components/security/SenderListActions';
import { Button } from '@/components/ui/button';
import { useApi, bustCache, bustCacheByPrefix } from '@/hooks/useApi';
import { getEmail, getEmailRaw } from '@/api/emailsApi';
import { getLatestScan, scanEmail } from '@/api/scansApi';
import { getSenderLists } from '@/api/senderListsApi';
import { useRegisterCommands } from '@/lib/commands';
import { emailId, getSenderAddress, getSenderName } from '@/lib/email';
import { getRiskMeta, getRuleDescription, getRuleLabel } from '@/lib/risk';
import { findListEntries } from '@/lib/senderLists';
import { isScored } from '@/lib/scoreScale';
import { AI_SCORE_MAX, RULE_SCORE_MAX, SCORE_MAX, getAiStatus } from '@/lib/scoring';
import { formatDateTime } from '@/utils/formatDate';
import { cn } from '@/lib/utils';

/* ─── small pieces ────────────────────────────────────────────────────────── */

const formatSize = (bytes) => {
  if (!Number.isFinite(bytes) || bytes < 0) return null;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

/* The score as a ring, drawn in the verdict's colour. */
function ScoreRing({ score, color }) {
  const scored = isScored(score);
  return (
    <div className="relative h-[68px] w-[68px] shrink-0" role="img" aria-label={scored ? `Risk score ${score} of ${SCORE_MAX}` : 'Not scored'}>
      <svg viewBox="0 0 68 68" className="h-full w-full -rotate-90">
        <circle cx="34" cy="34" r="29" fill="none" stroke="currentColor" strokeWidth="5" className="opacity-20" style={{ color }} />
        {scored && score > 0 && (
          <circle cx="34" cy="34" r="29" fill="none" strokeWidth="5" strokeLinecap="round" pathLength="100" strokeDasharray={`${score} 100`} style={{ stroke: color }} />
        )}
      </svg>
      <span className="data absolute inset-0 flex items-center justify-center text-[1.3125rem] font-semibold tracking-[-0.02em]" style={{ color }}>
        {scored ? score : '–'}
      </span>
    </div>
  );
}

/* A label / value line inside the folded details. */
function Fact({ label, children, tone }) {
  return (
    <div className="grid grid-cols-[9.5rem_minmax(0,1fr)] gap-x-4 py-1.5 text-sm max-sm:grid-cols-1">
      <dt className="text-muted-foreground-subtle">{label}</dt>
      <dd className={cn('min-w-0 break-words text-muted-foreground', tone)}>{children}</dd>
    </div>
  );
}

function DetailBlock({ title, children }) {
  return (
    <section className="min-w-0">
      <h4 className="mb-2 text-sm font-semibold">{title}</h4>
      {children}
    </section>
  );
}

function ScoreFigure({ label, value, max, valueLabel, note }) {
  const scored = isScored(value);
  return (
    <div className="min-w-0">
      <p className="text-[0.8125rem] text-muted-foreground-subtle">{label}</p>
      <p className="data mt-1 text-xl font-medium">
        {valueLabel ?? (scored ? value : '–')}
        {scored && <span className="text-sm font-normal text-muted-foreground-subtle"> / {max}</span>}
      </p>
      <ScoreMeter score={scored ? value : null} max={max} className="mt-2 w-full" />
      <p className="mt-1.5 text-[0.8125rem] text-muted-foreground-subtle">{note}</p>
    </div>
  );
}

/* ─── rescan after a proxy timeout ────────────────────────────────────────── */

const RESCAN_TIMEOUT_STATUSES = new Set([502, 503, 504, 524]);
const RESCAN_POLL_INTERVAL_MS = 5_000;
const RESCAN_POLL_ATTEMPTS = 72;

const scanTimestamp = (value) => {
  const parsed = Date.parse(value?.updatedAt || value?.scannedAt || value?.createdAt || '');
  return Number.isFinite(parsed) ? parsed : null;
};

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// A rescan that timed out at the proxy may still finish on the server. Poll
// the idempotent latest-scan read until a newer result lands, then give up.
const waitForTimedOutRescan = async ({ emailId: targetId, previousScan, requestedAt }) => {
  const previousTimestamp = scanTimestamp(previousScan);
  for (let attempt = 0; attempt < RESCAN_POLL_ATTEMPTS; attempt += 1) {
    await wait(RESCAN_POLL_INTERVAL_MS);
    try {
      const candidate = await getLatestScan(targetId);
      const ts = scanTimestamp(candidate);
      if ((ts !== null && ts >= requestedAt) || (previousTimestamp !== null && ts !== null && ts > previousTimestamp)) return candidate;
    } catch {
      // transient read failure: keep polling
    }
  }
  return null;
};

/* ─── empty pane ──────────────────────────────────────────────────────────── */

export function MessagePaneEmpty({ hint = 'Pick a message to see its verdict and why.' }) {
  return (
    <div className="flex h-full min-h-[320px] flex-col items-center justify-center gap-1.5 px-8 py-16 text-center">
      <p className="text-[0.9375rem] font-medium">Nothing open</p>
      <p className="max-w-[34ch] text-sm text-muted-foreground">{hint}</p>
    </div>
  );
}

/* ─── the pane ────────────────────────────────────────────────────────────── */

export function MessagePane({ id, onReviewed, onBack, onMove }) {
  const [email, setEmail] = useState(null);
  const [raw, setRaw] = useState(null);
  const [scan, setScan] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState(null);
  const [details, setDetails] = useState(false);
  const reviewRef = useRef(null);
  const topRef = useRef(null);

  const senderLists = useApi(getSenderLists, [], 'sender-lists');

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      const detail = await getEmail(id);
      const [rawResult, scanResult] = await Promise.allSettled([getEmailRaw(id), getLatestScan(id)]);
      setEmail(detail);
      setRaw(rawResult.status === 'fulfilled' ? rawResult.value : null);
      setScan(scanResult.status === 'fulfilled' ? scanResult.value : detail.latestScan || null);
    } catch (err) {
      setError(err.message || 'Could not load this message.');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    setEmail(null);
    setRaw(null);
    setScan(null);
    setScanError(null);
    setDetails(false);
    topRef.current?.scrollIntoView?.({ block: 'nearest' });
    load();
  }, [load]);

  const afterChange = (fresh) => {
    bustCacheByPrefix('inbox-', 'dash-', 'risky-');
    onReviewed?.(fresh);
  };

  const handleRescan = async () => {
    if (!email) return;
    setScanning(true);
    setScanError(null);
    const requestedAt = Date.now();
    try {
      const freshScan = await scanEmail(emailId(email));
      const freshEmail = await getEmail(id);
      setScan(freshScan);
      setEmail((prev) => ({ ...prev, ...freshEmail }));
      afterChange(freshEmail);
      toast.success('Scan complete');
    } catch (err) {
      if (RESCAN_TIMEOUT_STATUSES.has(err.statusCode)) {
        const completed = await waitForTimedOutRescan({ emailId: emailId(email), previousScan: scan, requestedAt });
        if (completed) {
          const freshEmail = await getEmail(id);
          setScan(completed);
          setEmail((prev) => ({ ...prev, ...freshEmail }));
          afterChange(freshEmail);
          toast.success('Scan complete');
          setScanning(false);
          return;
        }
      }
      // The previous verdict stays exactly as it was; the failure is said inline.
      setScanError(err.message || 'The scan failed. The previous result is unchanged.');
    } finally {
      setScanning(false);
    }
  };

  const handleListChanged = (message) => {
    bustCache('sender-lists');
    senderLists.reload();
    toast.success(message, {
      description: 'Applies the next time this message is scanned.',
      action: { label: 'Rescan', onClick: handleRescan },
    });
  };

  const ready = Boolean(email) && !loading;
  const userVerdict = email?.userVerdict ?? null;

  useRegisterCommands(
    'message',
    [
      { id: 'mark-phishing', label: 'Mark as phishing', group: 'Message', keys: 'p', disabled: !ready || scanning || userVerdict === 'phishing', run: () => reviewRef.current?.review('phishing') },
      { id: 'mark-safe', label: 'Mark as safe', group: 'Message', keys: 's', disabled: !ready || scanning || userVerdict === 'safe', run: () => reviewRef.current?.review('safe') },
      { id: 'rescan', label: 'Rescan this message', group: 'Message', keys: 'r', disabled: !ready || scanning, run: handleRescan },
      { id: 'details', label: 'Show or hide scoring details', group: 'Message', keys: 'd', disabled: !ready, run: () => setDetails((v) => !v) },
    ],
    [ready, scanning, userVerdict, id]
  );

  if (!id) return <MessagePaneEmpty />;
  if (loading && !email) return <LoadingState label="Loading message…" className="py-24" />;
  if (error) return <ErrorState message={error} onRetry={load} className="py-24" />;
  if (!email) return null;

  const { label: verdictLabel, description: verdictDescription, tone } = getRiskMeta(email.riskBucket);
  const score = scan?.score ?? email.latestScan?.score ?? null;
  const ruleScore = scan?.ruleScore ?? email.latestScan?.ruleScore ?? null;
  const aiScore = scan?.aiScore ?? email.latestScan?.aiScore ?? null;
  const ai = getAiStatus(scan || email.latestScan);
  const aiOff = ai.state !== 'ok';

  const senderName = getSenderName(email);
  const senderAddress = getSenderAddress(email);
  const reasons = Array.isArray(scan?.reasons) ? scan.reasons.filter(Boolean) : [];
  const summary = scan?.aiExplanation?.summary;
  const rules = Array.isArray(scan?.triggeredRules) ? scan.triggeredRules : [];
  const links = raw?.links || [];
  const attachments =
    Array.isArray(email.attachments) && email.attachments.length > 0
      ? email.attachments
      : (raw?.attachmentExtensions || email.attachmentExtensions || []).map((ext) => ({ filename: `.${String(ext).replace(/^\./, '')}`, declaredMimeType: null, size: null }));
  const analysisItems = Array.isArray(email.attachmentAnalysis?.items) ? email.attachmentAnalysis.items : [];
  const { senderEntry, domainEntry } = findListEntries(senderLists.data?.entries, senderAddress, email.senderDomain);
  const replyToDiffers = Boolean(email.replyToDomain) && email.replyToDomain !== email.senderDomain;
  const auth = email.authResults;

  return (
    <div ref={topRef} className="min-w-0">
      {/* toolbar */}
      <div className="flex items-center gap-1 px-3 pt-3 md:px-4">
        {onBack && (
          <Button variant="ghost" size="sm" onClick={onBack} className="md:hidden">
            <ArrowLeft />
            Inbox
          </Button>
        )}
        {onMove && (
          <div className="flex gap-0.5 max-md:hidden">
            <Button variant="ghost" size="icon" aria-label="Previous message" onClick={() => onMove(-1)}>
              <ChevronUp />
            </Button>
            <Button variant="ghost" size="icon" aria-label="Next message" onClick={() => onMove(1)}>
              <ChevronDown />
            </Button>
          </div>
        )}
        <div className="ml-auto flex items-center gap-0.5">
          <SenderListActions senderAddress={senderAddress} senderDomain={email.senderDomain} senderEntry={senderEntry} domainEntry={domainEntry} onChanged={handleListChanged} />
          <Button variant="ghost" size="icon" aria-label={scanning ? 'Scanning' : 'Rescan this message'} title="Rescan" disabled={scanning} onClick={handleRescan}>
            {scanning ? <Loader2 className="animate-spin" /> : <RotateCw />}
          </Button>
        </div>
      </div>

      <div className="px-5 pb-12 pt-3 md:px-12 md:pt-4">
        {/* 1 ─ sender and subject */}
        <div className="flex items-center gap-3.5">
          <Avatar name={senderName || senderAddress} size="lg" />
          <div className="min-w-0">
            <p className="truncate text-[0.9375rem] font-semibold">{senderName}</p>
            {senderAddress && senderAddress !== senderName && <p className="truncate text-sm text-muted-foreground-subtle">{senderAddress}</p>}
          </div>
          <time className="ml-auto shrink-0 text-[0.8125rem] text-muted-foreground-subtle max-sm:hidden">{formatDateTime(email.receivedAt)}</time>
        </div>
        <h2 className="mt-5 max-w-[40ch] text-h1 font-medium break-words">{email.subject || '(no subject)'}</h2>

        {/* 2 ─ verdict */}
        <div
          className="mt-6 grid items-center gap-x-5 gap-y-4 rounded-[1.125rem] p-5 sm:grid-cols-[auto_minmax(0,1fr)] lg:grid-cols-[auto_minmax(0,1fr)_auto] md:px-6"
          style={{
            background: `linear-gradient(120deg, color-mix(in srgb, ${tone.hex} 9%, transparent), color-mix(in srgb, ${tone.hex} 2.5%, transparent) 60%, transparent)`,
            boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${tone.hex} 15%, transparent)`,
          }}
        >
          <div className="flex items-center gap-5 sm:contents">
            <ScoreRing score={score} color={tone.hex} />
            <div className="min-w-0">
              <p className="text-[1.1875rem] font-semibold tracking-[-0.01em]" style={{ color: tone.hex }}>
                {verdictLabel}
              </p>
              <p className="mt-0.5 text-[0.90625rem] text-muted-foreground">{verdictDescription}</p>
            </div>
          </div>
          <ReviewActions
            ref={reviewRef}
            email={email}
            disabled={scanning}
            className="sm:col-span-2 lg:col-span-1"
            onReviewed={async () => {
              // The action returns a summary, not the message; read the message
              // again so the verdict, the bucket and the Gmail row are current.
              try {
                const fresh = await getEmail(id);
                setEmail((prev) => ({ ...prev, ...fresh }));
                afterChange(fresh);
              } catch {
                afterChange(null);
              }
            }}
          />
        </div>
        {scanError && (
          <p role="alert" className="mt-3 flex items-start gap-2 text-sm text-destructive">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span className="min-w-0 break-words">{scanError}</span>
          </p>
        )}

        {/* 3 ─ why, beside the sender check */}
        <div className="mt-8 grid gap-8 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)] lg:gap-14">
          <section className="min-w-0">
            <h3 className="mb-3 text-[0.9375rem] font-semibold">{reasons.length > 0 ? 'Why it was flagged' : 'What we found'}</h3>
            {reasons.length > 0 ? (
              <ul className="grid gap-2">
                {reasons.map((reason, i) => (
                  <li key={i} className="grid grid-cols-[6px_minmax(0,1fr)] gap-3.5 text-[0.9375rem] leading-relaxed text-muted-foreground">
                    <span aria-hidden="true" className="mt-[9px] h-1.5 w-1.5 rounded-full" style={{ backgroundColor: tone.hex }} />
                    <span className="min-w-0 break-words">{reason}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-[0.9375rem] text-muted-foreground">Nothing stood out. No detection rule matched this message.</p>
            )}
            {scan?.senderVerifiedBrand && (
              <p className="mt-3 text-sm text-muted-foreground-subtle">
                Verified brand: <span className="text-foreground">{scan.verifiedBrandName || email.senderDomain}</span>.
              </p>
            )}
            {scan?.senderListMatch?.value && (
              <p className="mt-3 text-sm text-muted-foreground-subtle">
                Your rule applies: <span className="text-foreground">{scan.senderListMatch.value}</span> is {scan.senderListMatch.listType === 'allow' ? 'trusted' : 'blocked'}.
              </p>
            )}
          </section>

          <section className="min-w-0">
            <h3 className="mb-1.5 text-[0.9375rem] font-semibold">Sender check</h3>
            <SenderAuthentication authResults={auth} />
            {(email.isFirstTimeSender || replyToDiffers) && (
              <div className="mt-3 text-[0.8125rem] leading-relaxed text-muted-foreground-subtle">
                {email.isFirstTimeSender && <p>First message from this sender.</p>}
                {replyToDiffers && (
                  <p className="flex min-w-0 gap-1.5">
                    <span className="shrink-0">Replies go to</span>
                    <span className="truncate text-risk-review" title={email.replyTo || email.replyToDomain}>
                      {email.replyTo || email.replyToDomain}
                    </span>
                  </p>
                )}
              </div>
            )}
          </section>
        </div>

        {/* 4 ─ the message */}
        <section aria-label="Message" className="mt-9 rounded-[1.125rem] bg-well p-3 sm:p-4 md:p-5">
          {/* Its own row: a float here narrowed the whole email beside it. */}
          <p className="mb-3 flex items-center justify-end gap-1.5 px-1 text-xs text-muted-foreground-subtle">
            <Lock className="h-3 w-3" />
            Links disabled
          </p>
          <EmailBody htmlBody={raw?.htmlBody} textBody={raw?.textBody} riskBucket={email.riskBucket} />
          {attachments.length > 0 && (
            <ul className="mt-4 grid gap-2 border-t border-border px-1 pt-4">
              {attachments.map((attachment, i) => {
                const analysis = analysisItems.find((item) => item?.attachmentIndex === i);
                const findings = Array.isArray(analysis?.findings) ? analysis.findings : [];
                const type = analysis?.detectedMimeType || attachment.declaredMimeType;
                const size = formatSize(attachment.size);
                return (
                  <li key={`${attachment.filename || 'attachment'}-${i}`} className="flex min-w-0 items-start gap-2.5 text-sm">
                    <Paperclip className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground-subtle" aria-hidden="true" />
                    <div className="min-w-0">
                      <span className="break-all">{attachment.filename || 'Attachment'}</span>
                      {(type || size) && <span className="text-muted-foreground-subtle"> · {[size, type].filter(Boolean).join(' · ')}</span>}
                      {findings.length > 0 && <p className="mt-0.5 text-[0.8125rem] text-risk-review">{findings.map(getRuleLabel).join(' · ')}</p>}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {/* 5 ─ scoring details, folded */}
        <button
          type="button"
          aria-expanded={details}
          onClick={() => setDetails((v) => !v)}
          className="focus-ring mt-4 flex w-full items-center gap-2.5 rounded-lg px-1 py-3 text-left text-[0.9375rem] text-muted-foreground hover:text-foreground"
        >
          <ChevronRight className={cn('h-4 w-4 text-muted-foreground-subtle transition-transform duration-[var(--duration-fast)]', details && 'rotate-90')} />
          Scoring details
          <span className="data ml-auto text-sm text-muted-foreground-subtle">
            {rules.length} {rules.length === 1 ? 'rule' : 'rules'}
            {isScored(score) ? ` · ${score} of ${SCORE_MAX}` : ''}
          </span>
        </button>

        {details && (
          <div className="grid gap-8 border-t border-border pt-6">
            <div className="grid gap-6 sm:grid-cols-3">
              <ScoreFigure label="Rules" value={ruleScore} max={RULE_SCORE_MAX} note={`${rules.length} ${rules.length === 1 ? 'rule' : 'rules'} fired`} />
              {aiOff ? (
                <ScoreFigure label="AI model" value={null} max={AI_SCORE_MAX} valueLabel={{ disabled: 'Off', skipped: 'Not needed' }[ai.state] || 'Unavailable'} note="The rule score stands alone" />
              ) : (
                <ScoreFigure label="AI model" value={aiScore} max={AI_SCORE_MAX} note={`Capped at ${AI_SCORE_MAX}; never enough alone`} />
              )}
              <ScoreFigure label="Combined" value={isScored(score) ? score : null} max={SCORE_MAX} note={verdictLabel} />
            </div>

            <div className="grid gap-8 lg:grid-cols-2 lg:gap-14">
              <DetailBlock title="Rules that fired">
                {rules.length > 0 ? (
                  <ul className="divide-y divide-border">
                    {rules.map((rule, i) => (
                      <li key={`${rule.rule}-${i}`} className="grid grid-cols-[minmax(0,1fr)_auto] gap-4 py-2.5">
                        <div className="min-w-0">
                          <p className="text-sm">{getRuleLabel(rule.rule)}</p>
                          <p className="mt-0.5 text-[0.8125rem] leading-relaxed text-muted-foreground-subtle break-words">{rule.details || getRuleDescription(rule.rule)}</p>
                        </div>
                        <span className="data text-sm text-muted-foreground">+{rule.points}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-muted-foreground">No detection rule matched.</p>
                )}
              </DetailBlock>

              <DetailBlock title="Explanation">
                <p className="text-sm leading-relaxed text-muted-foreground break-words">{summary || ai.message || 'The model did not produce a reading for this scan.'}</p>
                {aiOff && summary && <p className="mt-2 text-[0.8125rem] text-muted-foreground-subtle">{ai.message}</p>}
              </DetailBlock>

              <DetailBlock title={`Links${links.length ? ` (${links.length})` : ''}`}>
                <LinkList links={links} />
              </DetailBlock>

              <DetailBlock title="Sender verification">
                <SenderAuthentication authResults={auth} detailed />
              </DetailBlock>

              <DetailBlock title="Facts">
                <dl>
                  <Fact label="Reply-To" tone={replyToDiffers ? 'text-risk-review' : undefined}>{email.replyTo || 'Same as sender'}</Fact>
                  <Fact label="Domain policy">{auth?.dmarc?.policy ? `p=${auth.dmarc.policy}` : 'None published'}</Fact>
                  <Fact label="Forwarding (ARC)">{auth?.arc?.result && auth.arc.result !== 'none' ? auth.arc.result : 'Not present'}</Fact>
                  <Fact label="Your decision" tone={userVerdict === 'phishing' ? 'text-risk-phishing' : userVerdict === 'safe' ? 'text-risk-safe' : undefined}>
                    {userVerdict ? `Marked as ${userVerdict}` : 'None yet'}
                  </Fact>
                  <Fact label="Gmail" tone={email.lastProviderActionStatus === 'failed' ? 'text-risk-review' : undefined}>
                    {email.lastProviderAction
                      ? `${String(email.lastProviderAction).replace(/_/g, ' ')}: ${email.lastProviderActionStatus || 'unknown'}`
                      : 'No action taken'}
                    {email.lastProviderActionError?.message && <span className="block text-muted-foreground-subtle">{email.lastProviderActionError.message}</span>}
                  </Fact>
                  <Fact label="Scanned">{scan?.scannedAt ? formatDateTime(scan.scannedAt) : 'Never'}</Fact>
                </dl>
              </DetailBlock>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
