// ─────────────────────────────────────────────────────────────────────────────
// MessagePane.jsx — the evidence pane: everything about one message.
//
// Fixed order, top to bottom:
//   1. Header   — subject, who sent it, when; the sender-scoped Trust/Block.
//   2. Verdict strip — the decision: score, verdict word, and the three
//      actions with their keys. The only large colour on the screen.
//   3. Three tabs:
//        Verdict  — why we flagged it, what the AI read, how the score was
//                   reached, the rules that fired.
//        Message  — the sanitised body (links dead), links, attachments.
//        Evidence — identity (From vs Reply-To), sender verification, links
//                   at a glance, your decision, what Gmail did, scan metadata.
//
// Data: getEmail (detail + state), getEmailRaw (body, links), getLatestScan
// (score, reasons, rules, AI metadata), getSenderLists (trust/block state).
// ─────────────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, ArrowLeft, Loader2, Paperclip, ScanLine } from 'lucide-react';
import { toast } from 'sonner';

import { ErrorState, LoadingState } from '@/components/common/states';
import { EmailBody } from '@/components/inbox/EmailBody';
import { LinkList } from '@/components/inbox/LinkList';
import { ScoreMeter } from '@/components/inbox/ScoreMeter';
import { ReviewActions } from '@/components/security/ReviewActions';
import { SenderAuthentication } from '@/components/security/SenderAuthentication';
import { SenderListActions } from '@/components/security/SenderListActions';
import { Button } from '@/components/ui/button';
import { Kbd } from '@/components/ui/kbd';
import { useApi, bustCache, bustCacheByPrefix } from '@/hooks/useApi';
import { getEmail, getEmailRaw } from '@/api/emailsApi';
import { getLatestScan, scanEmail } from '@/api/scansApi';
import { getSenderLists } from '@/api/senderListsApi';
import { useRegisterCommands } from '@/lib/commands';
import { emailId, getSenderAddress, getSenderName } from '@/lib/email';
import { getRiskMeta, getRuleDescription, getRuleLabel } from '@/lib/risk';
import { findListEntries } from '@/lib/senderLists';
import { getRiskTextColor, isScored, UNSCORED_COLOR } from '@/lib/scoreScale';
import { AI_SCORE_MAX, RULE_SCORE_MAX, SCORE_MAX, getAiStatus } from '@/lib/scoring';
import { formatDateTime } from '@/utils/formatDate';
import { cn } from '@/lib/utils';

/* ─── small pieces ────────────────────────────────────────────────────────── */

function Section({ title, note, children, className }) {
  return (
    <section className={cn('pt-7 first:pt-0', className)}>
      <div className="mb-3 flex items-baseline gap-3 border-b border-border pb-2">
        <h3 className="label-section text-foreground">{title}</h3>
        {note && <span className="data ml-auto text-[0.6875rem] text-muted-foreground-subtle">{note}</span>}
      </div>
      {children}
    </section>
  );
}

const Quiet = ({ children }) => <p className="text-[0.8125rem] text-muted-foreground">{children}</p>;

/* A fact: label on the left, value on the right, in mono. */
function Fact({ label, children, tone }) {
  return (
    <div className="grid grid-cols-[9rem_minmax(0,1fr)] gap-x-4 border-b border-border py-2 text-xs last:border-b-0 max-sm:grid-cols-1 max-sm:gap-y-0.5">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={cn('data min-w-0 break-words', tone)}>{children}</dd>
    </div>
  );
}

const formatSize = (bytes) => {
  if (!Number.isFinite(bytes) || bytes < 0) return null;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

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

export function MessagePaneEmpty({ hint = 'Select a message to see its verdict and the evidence behind it.' }) {
  return (
    <div className="flex h-full min-h-[320px] flex-col items-center justify-center gap-2 px-8 py-16 text-center">
      <p className="text-sm font-medium text-foreground/80">Nothing open</p>
      <p className="max-w-[36ch] text-xs text-muted-foreground">{hint}</p>
      <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground-subtle max-md:hidden">
        <Kbd>J</Kbd>
        <Kbd>K</Kbd>
        to move, <Kbd>?</Kbd> for every shortcut
      </p>
    </div>
  );
}

const TABS = [
  { key: 'verdict', label: 'Verdict', keys: 'v' },
  { key: 'message', label: 'Message', keys: 'm' },
  { key: 'evidence', label: 'Evidence', keys: 'e' },
];

/* ─── the pane ────────────────────────────────────────────────────────────── */

export function MessagePane({ id, onReviewed, onBack }) {
  const [email, setEmail] = useState(null);
  const [raw, setRaw] = useState(null);
  const [scan, setScan] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState(null);
  const [tab, setTab] = useState('verdict');
  const reviewRef = useRef(null);
  const scrollRef = useRef(null);

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
    scrollRef.current?.scrollTo?.({ top: 0 });
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
      { id: 'mark-phishing', label: 'Mark phishing', group: 'Message', keys: 'p', disabled: !ready || scanning || userVerdict === 'phishing', run: () => reviewRef.current?.review('phishing') },
      { id: 'mark-safe', label: 'Mark safe', group: 'Message', keys: 's', disabled: !ready || scanning || userVerdict === 'safe', run: () => reviewRef.current?.review('safe') },
      { id: 'rescan', label: 'Rescan this message', group: 'Message', keys: 'r', disabled: !ready || scanning, run: handleRescan },
      ...TABS.map((t) => ({ id: `tab-${t.key}`, label: `Show ${t.label.toLowerCase()}`, group: 'Message', keys: t.keys, disabled: !ready, run: () => setTab(t.key) })),
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
  const scored = isScored(score);
  const scoreColor = scored ? getRiskTextColor(score) : UNSCORED_COLOR;

  const senderName = getSenderName(email);
  const senderAddress = getSenderAddress(email);
  const reasons = Array.isArray(scan?.reasons) ? scan.reasons.filter(Boolean) : [];
  const summary = scan?.aiExplanation?.summary;
  const rules = Array.isArray(scan?.triggeredRules) ? scan.triggeredRules : [];
  const links = raw?.links || [];
  const attachments = Array.isArray(email.attachments) && email.attachments.length > 0
    ? email.attachments
    : (raw?.attachmentExtensions || email.attachmentExtensions || []).map((ext) => ({ filename: `.${String(ext).replace(/^\./, '')}`, declaredMimeType: null, size: null }));
  const analysisItems = Array.isArray(email.attachmentAnalysis?.items) ? email.attachmentAnalysis.items : [];
  const { senderEntry, domainEntry } = findListEntries(senderLists.data?.entries, senderAddress, email.senderDomain);
  const replyToDiffers = Boolean(email.replyToDomain) && email.replyToDomain !== email.senderDomain;

  return (
    <div ref={scrollRef} className="flex h-full min-w-0 flex-col">
      {/* 1 ─ header */}
      <div className="shrink-0 border-b border-border px-4 pb-4 pt-4 md:px-6">
        {onBack && (
          <button type="button" onClick={onBack} className="focus-ring mb-3 -ml-1 flex items-center gap-1 rounded px-1 text-xs text-muted-foreground hover:text-foreground md:hidden">
            <ArrowLeft className="h-3.5 w-3.5" />
            Back to list
          </button>
        )}
        <h2 className="text-h2 font-semibold break-words">{email.subject || '(no subject)'}</h2>
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2">
          <div className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2 gap-y-0.5 text-xs">
            <span className="font-medium text-foreground">{senderName}</span>
            {senderAddress && senderAddress !== senderName && <span className="data min-w-0 truncate text-muted-foreground">{senderAddress}</span>}
            <span className="data whitespace-nowrap text-muted-foreground-subtle">{formatDateTime(email.receivedAt)}</span>
          </div>
          <SenderListActions senderAddress={senderAddress} senderDomain={email.senderDomain} senderEntry={senderEntry} domainEntry={domainEntry} onChanged={handleListChanged} />
        </div>
      </div>

      {/* 2 ─ verdict strip */}
      <div
        className="shrink-0 border-b border-border border-l-[3px] px-4 py-4 md:px-6"
        style={{ borderLeftColor: tone.hex, background: `linear-gradient(90deg, color-mix(in srgb, ${tone.hex} 9%, transparent), transparent 55%)` }}
      >
        <div className="flex flex-wrap items-center gap-x-6 gap-y-4">
          <div className="flex items-center gap-4">
            <div className="data flex items-baseline gap-1 text-[2.75rem] font-medium leading-none" style={{ color: scoreColor }}>
              {scored ? score : '–'}
              <span className="text-xs font-normal text-muted-foreground">/{SCORE_MAX}</span>
            </div>
            <div className="min-w-0">
              <p className="text-[0.9375rem] font-semibold" style={{ color: tone.hex }}>{verdictLabel}</p>
              <p className="max-w-[40ch] text-xs text-muted-foreground">{verdictDescription}</p>
              <ScoreMeter score={score} className="mt-2 w-32" />
            </div>
          </div>

          <div className="ml-auto flex flex-wrap items-center gap-1.5">
            <ReviewActions ref={reviewRef} email={email} hints disabled={scanning} onReviewed={(result) => { setEmail((prev) => ({ ...prev, ...result })); afterChange(result); }} />
            <Button variant="ghost" disabled={scanning} onClick={handleRescan}>
              {scanning ? <Loader2 className="animate-spin" /> : <ScanLine />}
              {scanning ? 'Scanning…' : 'Rescan'}
              {!scanning && <Kbd className="max-md:hidden">R</Kbd>}
            </Button>
          </div>
        </div>
        {scanError && (
          <p role="alert" className="mt-2 flex items-start gap-1.5 text-xs text-destructive">
            <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" />
            <span className="min-w-0 break-words">{scanError}</span>
          </p>
        )}
      </div>

      {/* 3 ─ tabs */}
      <div role="tablist" aria-label="Message sections" className="flex shrink-0 gap-0.5 border-b border-border px-2 md:px-4">
        {TABS.map((t) => {
          const count = t.key === 'verdict' ? rules.length : t.key === 'message' ? links.length + attachments.length : null;
          const isActive = tab === t.key;
          return (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => setTab(t.key)}
              className={cn(
                'focus-ring relative flex items-center gap-1.5 px-2.5 py-2.5 text-xs transition-colors',
                isActive ? 'font-medium text-foreground' : 'text-muted-foreground hover:text-foreground'
              )}
            >
              {t.label}
              {count > 0 && <span className="data text-[0.6875rem] text-muted-foreground-subtle">{count}</span>}
              <Kbd className="max-md:hidden">{t.keys.toUpperCase()}</Kbd>
              {isActive && <span aria-hidden="true" className="absolute inset-x-2 -bottom-px h-[2px] rounded-full bg-foreground" />}
            </button>
          );
        })}
      </div>

      <div className="min-w-0 flex-1 px-4 pb-16 pt-5 md:px-6">
        {tab === 'verdict' && (
          <>
            <Section title="Why we flagged it">
              {reasons.length > 0 ? (
                <ul className="grid gap-2">
                  {reasons.map((reason, i) => (
                    <li key={i} className="grid grid-cols-[0.5rem_minmax(0,1fr)] items-baseline gap-2.5 text-[0.8125rem] leading-relaxed text-foreground/90">
                      <span aria-hidden="true" className="h-1.5 w-1.5 translate-y-[-1px] rounded-full" style={{ backgroundColor: tone.hex }} />
                      <span className="min-w-0 break-words">{reason}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                !summary && <Quiet>Nothing stood out. No detection rule matched this message.</Quiet>
              )}
              {scan?.senderVerifiedBrand && (
                <p className="mt-3 text-xs text-muted-foreground">
                  Verified brand: <span className="font-medium text-foreground">{scan.verifiedBrandName || email.senderDomain}</span>. The sender proved it owns this domain, so brand impersonation signals were not applied.
                </p>
              )}
              {scan?.senderListMatch?.value && (
                <p className="mt-3 text-xs text-muted-foreground">
                  Matched your rule: <span className="data text-foreground">{scan.senderListMatch.value}</span> is {scan.senderListMatch.listType === 'allow' ? 'trusted' : 'blocked'}.
                </p>
              )}
            </Section>

            <Section title="What the AI read" note={aiOff ? (ai.state === 'disabled' ? 'AI off · template' : ai.state) : 'local model'}>
              {summary ? (
                <p className="max-w-[70ch] text-[0.8125rem] leading-relaxed text-foreground/90 break-words">{summary}</p>
              ) : (
                <Quiet>{ai.message || 'The model did not produce a summary for this scan.'}</Quiet>
              )}
            </Section>

            <Section title="How the score was reached">
              <div className="grid gap-5 sm:grid-cols-3">
                <ScoreFigure label="Rule engine" value={ruleScore} max={RULE_SCORE_MAX} note={`${rules.length} ${rules.length === 1 ? 'rule' : 'rules'} fired`} />
                {aiOff ? (
                  <ScoreFigure label="AI model" value={null} max={AI_SCORE_MAX} valueLabel={ai.state === 'disabled' ? 'Off' : 'Unavailable'} note={ai.state === 'disabled' ? 'AI scoring is turned off' : 'Rule score shown alone'} />
                ) : (
                  <ScoreFigure label="AI model" value={aiScore} max={AI_SCORE_MAX} note={`capped at ${AI_SCORE_MAX}; AI alone can never reach phishing`} />
                )}
                <ScoreFigure label="Combined" value={scored ? score : null} max={SCORE_MAX} note={verdictLabel} color={scoreColor} />
              </div>
            </Section>

            <Section title="Rules that fired" note={rules.length > 0 ? `${rules.length}` : 'none'}>
              {rules.length > 0 ? (
                <ul className="divide-y divide-border">
                  {rules.map((rule, i) => (
                    <li key={`${rule.rule}-${i}`} className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-4 py-2.5">
                      <div className="min-w-0">
                        <p className="text-[0.8125rem] font-medium break-words">{getRuleLabel(rule.rule)}</p>
                        <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground break-words">{rule.details || getRuleDescription(rule.rule)}</p>
                      </div>
                      <span className="data text-[0.8125rem] font-medium text-foreground">+{rule.points}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <Quiet>No detection rule matched this message.</Quiet>
              )}
            </Section>
          </>
        )}

        {tab === 'message' && (
          <>
            <Section title="Message" note="links are disabled">
              <EmailBody htmlBody={raw?.htmlBody} textBody={raw?.textBody} riskBucket={email.riskBucket} />
            </Section>
            <Section title="Links" note={links.length > 0 ? `${links.length}` : 'none'}>
              <LinkList links={links} />
            </Section>
            <Section title="Attachments" note={attachments.length > 0 ? `${attachments.length}` : 'none'}>
              {attachments.length > 0 ? (
                <ul className="divide-y divide-border">
                  {attachments.map((attachment, i) => {
                    const analysis = analysisItems.find((item) => item?.attachmentIndex === i);
                    const findings = Array.isArray(analysis?.findings) ? analysis.findings : [];
                    const type = analysis?.detectedMimeType || attachment.declaredMimeType;
                    const size = formatSize(attachment.size);
                    return (
                      <li key={`${attachment.filename || 'attachment'}-${i}`} className="flex items-start gap-3 py-2.5">
                        <Paperclip className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground-subtle" aria-hidden="true" />
                        <div className="min-w-0">
                          <p className="data truncate text-xs">{attachment.filename || 'Attachment'}</p>
                          {(type || size) && <p className="data mt-0.5 text-[0.6875rem] text-muted-foreground">{[type, size].filter(Boolean).join(' · ')}</p>}
                          {findings.length > 0 && <p className="mt-1 text-xs text-risk-review">{findings.map(getRuleLabel).join(' · ')}</p>}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <Quiet>This message has no attachments.</Quiet>
              )}
            </Section>
          </>
        )}

        {tab === 'evidence' && (
          <>
            <Section title="Identity">
              <dl>
                <Fact label="From">{senderName}{senderAddress && senderAddress !== senderName ? ` <${senderAddress}>` : ''}</Fact>
                <Fact label="Reply-To" tone={replyToDiffers ? 'text-risk-review' : undefined}>
                  {email.replyTo ? `${email.replyTo}${replyToDiffers ? '  (differs from the sender)' : ''}` : 'same as sender'}
                </Fact>
                <Fact label="Sender domain">{email.senderDomain || 'unknown'}</Fact>
                <Fact label="History" tone={email.isFirstTimeSender ? 'text-risk-review' : undefined}>
                  {email.isFirstTimeSender ? 'first message from this sender' : 'you have received mail from this sender before'}
                </Fact>
                <Fact label="Received">{formatDateTime(email.receivedAt)}</Fact>
              </dl>
            </Section>

            <Section title="Sender verification">
              <SenderAuthentication authResults={email.authResults} />
            </Section>

            <Section title="Links at a glance">
              <dl>
                <Fact label="Links">{email.linkCount ?? links.length}</Fact>
                <Fact label="Domains">{(email.linkDomains || []).length > 0 ? email.linkDomains.join('  ') : 'none'}</Fact>
                <Fact label="Shortened links" tone={email.hasShortenedUrl ? 'text-risk-review' : undefined}>{email.hasShortenedUrl ? 'yes' : 'no'}</Fact>
                <Fact label="Patterns" tone={(email.suspiciousLinkPatterns || []).length > 0 ? 'text-risk-review' : undefined}>
                  {(email.suspiciousLinkPatterns || []).length > 0 ? email.suspiciousLinkPatterns.map((p) => getRuleLabel(`suspicious_link_pattern:${p}`)).join(' · ') : 'none'}
                </Fact>
                <Fact label="Attachments">{(email.attachmentExtensions || []).length > 0 ? email.attachmentExtensions.map((e) => `.${e}`).join(' ') : 'none'}</Fact>
              </dl>
            </Section>

            <Section title="Your decision">
              <dl>
                <Fact label="Verdict" tone={userVerdict === 'phishing' ? 'text-risk-phishing' : userVerdict === 'safe' ? 'text-risk-safe' : undefined}>
                  {userVerdict ? `marked ${userVerdict}` : 'none yet'}
                </Fact>
                {email.reviewedAt && <Fact label="Reviewed">{formatDateTime(email.reviewedAt)}</Fact>}
                <Fact label="Gmail action" tone={email.lastProviderActionStatus === 'failed' ? 'text-risk-review' : undefined}>
                  {email.lastProviderAction
                    ? `${String(email.lastProviderAction).replace(/_/g, ' ')}: ${email.lastProviderActionStatus || 'unknown'}${email.lastProviderActionAt ? ` at ${formatDateTime(email.lastProviderActionAt)}` : ''}`
                    : 'none'}
                  {email.lastProviderActionError?.message && <span className="block text-muted-foreground">{email.lastProviderActionError.message}</span>}
                </Fact>
              </dl>
            </Section>

            <Section title="Scan">
              <dl>
                <Fact label="Scanned">{scan?.scannedAt ? formatDateTime(scan.scannedAt) : 'never'}</Fact>
                {scan?.scanSource && <Fact label="Trigger">{String(scan.scanSource).replace(/_/g, ' ')}</Fact>}
                {scan?.engineVersion && <Fact label="Engine">{scan.engineVersion}</Fact>}
                <Fact label="AI">
                  {aiOff
                    ? ai.message
                    : [scan?.aiExplanationMeta?.source, scan?.aiExplanationMeta?.mode, Number.isFinite(scan?.aiExplanationMeta?.latencyMs) ? `${scan.aiExplanationMeta.latencyMs} ms` : null].filter(Boolean).join(' · ') || 'generated'}
                </Fact>
                <Fact label="Verdict source">{email.verdictSource ? (email.verdictSource === 'user' ? 'your decision' : 'scan') : 'scan'}</Fact>
              </dl>
            </Section>
          </>
        )}
      </div>
    </div>
  );
}

/* One figure in "How the score was reached": value, a bar against its own
   maximum, a note. */
function ScoreFigure({ label, value, max, valueLabel, note, color }) {
  const scored = isScored(value);
  return (
    <div className="min-w-0">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={cn('mt-1 text-2xl font-medium leading-none', valueLabel ? 'text-muted-foreground' : 'data')} style={color ? { color } : undefined}>
        {valueLabel ?? (scored ? value : '–')}
        {scored && <span className="text-xs font-normal text-muted-foreground"> /{max}</span>}
      </p>
      <ScoreMeter score={scored ? value : null} max={max} hex={color} className="mt-2 w-full" />
      <p className="mt-1.5 text-[0.6875rem] text-muted-foreground-subtle">{note}</p>
    </div>
  );
}
