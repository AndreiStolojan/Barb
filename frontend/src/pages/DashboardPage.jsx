// ─────────────────────────────────────────────────────────────────────────────
// DashboardPage.jsx — the briefing.
//
// One question first, "is there anything I need to do?", answered by the hero
// card in a single sentence with the button that does it. Beside it, how the
// range breaks down. Below: flagged mail per day, the messages waiting for a
// decision, and the domains the risky mail came from.
//
// Category colours come from lib/risk.js; a numeric score is coloured from
// the continuous ramp in lib/scoreScale.js.
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Check, Loader2, RefreshCw, Send, ShieldAlert, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';

import { BriefingSkeleton, ConnectGmailState, ErrorState } from '@/components/common/states';
import { TimeRangeFilter } from '@/components/common/TimeRangeFilter';
import { Avatar } from '@/components/inbox/EmailRow';
import { PagePanel } from '@/components/layout/AppShell';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useApi } from '@/hooks/useApi';
import { useAuth } from '@/hooks/useAuth';
import { useAsyncAction } from '@/hooks/useAsyncAction';
import { useMailAccount } from '@/context/MailAccountContext';
import { useTimeRange } from '@/context/TimeRangeContext';
import { getEmails, getEmailStats, getEmailTrend, getTopRiskySenders } from '@/api/emailsApi';
import { sendReportSummary } from '@/api/reportsApi';
import { normalizeEmailList } from '@/lib/email-list';
import { emailId, getSenderName } from '@/lib/email';
import { CATEGORY_COLORS, CATEGORY_LABELS } from '@/lib/risk';
import { getPostureLabel, getRiskTextColor, isScored } from '@/lib/scoreScale';
import { cn } from '@/lib/utils';

/* ─── helpers ─────────────────────────────────────────────────────────────── */

const plural = (n, one, many) => (n === 1 ? one : many);

const formatAxisDate = (dateStr) => {
  const d = new Date(`${dateStr}T00:00:00`);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};

// The email's score as an integer 0–100, or null when it was never scored.
const scoreOf = (email) => {
  const raw = email?.latestScan?.score ?? email?.score;
  if (raw === null || raw === undefined) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? Math.min(100, Math.max(0, Math.round(n))) : null;
};

const receivedAtMs = (email) => {
  const t = new Date(email?.receivedAt ?? 0).getTime();
  return Number.isNaN(t) ? 0 : t;
};

const greeting = (date = new Date()) => {
  const h = date.getHours();
  if (h < 5) return 'Good evening';
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
};

function Card({ title, aside, className, children }) {
  return (
    <section className={cn('card min-w-0 p-5 md:px-[26px] md:py-6', className)}>
      {(title || aside) && (
        <div className="mb-4 flex items-start justify-between gap-4">
          {title && <h2 className="text-[0.9375rem] font-semibold">{title}</h2>}
          {aside}
        </div>
      )}
      {children}
    </section>
  );
}

const Quiet = ({ children }) => <p className="text-sm leading-relaxed text-muted-foreground">{children}</p>;

/* ─── hero ────────────────────────────────────────────────────────────────── */

function calmDetail({ scanned, total, confirmed }) {
  if (scanned === 0) {
    return total > 0 ? 'None of the synced messages have been scanned yet, so there is nothing to judge.' : 'Nothing has been synced for this time range yet.';
  }
  if (confirmed > 0) return `Everything scanned came back clean. The ${confirmed} you marked as phishing ${plural(confirmed, 'is', 'are')} handled.`;
  return `All ${scanned} scanned ${plural(scanned, 'message', 'messages')} came back clean.`;
}

function Hero({ counts, total, scanned, safeRate }) {
  const quarantine = counts.quarantine ?? 0;
  const needsReview = counts.needs_review ?? 0;
  const confirmed = counts.confirmed_phishing ?? 0;

  let tone = CATEGORY_COLORS.safe;
  let Icon = ShieldCheck;
  let headline;
  let detail;
  let reviewTo = null;
  let reviewCount = 0;

  if (scanned > 0 && quarantine > 0) {
    tone = CATEGORY_COLORS.likely_phishing;
    Icon = ShieldAlert;
    headline = (
      <>
        <span style={{ color: tone }}>
          {quarantine} {plural(quarantine, 'message', 'messages')}
        </span>{' '}
        {plural(quarantine, 'looks', 'look')} like phishing
      </>
    );
    detail = needsReview > 0 ? `${needsReview} more ${plural(needsReview, 'is', 'are')} worth a second look.` : 'Nothing else needs your attention.';
    reviewTo = '/inbox?riskBucket=quarantine';
    reviewCount = quarantine;
  } else if (scanned > 0 && needsReview > 0) {
    tone = CATEGORY_COLORS.suspicious;
    Icon = ShieldAlert;
    headline = (
      <>
        <span style={{ color: tone }}>
          {needsReview} {plural(needsReview, 'message', 'messages')}
        </span>{' '}
        {plural(needsReview, 'is', 'are')} worth a second look
      </>
    );
    detail = 'Nothing here looks like an outright phishing attempt.';
    reviewTo = '/inbox?riskBucket=needs_review';
    reviewCount = needsReview;
  } else {
    headline = scanned === 0 ? 'Nothing to report yet' : getPostureLabel(safeRate);
    detail = calmDetail({ scanned, total, confirmed });
  }

  return (
    <section className="card flex min-w-0 flex-col justify-between gap-7 p-6 md:px-8 md:py-7">
      <div>
        <span className="mb-4 flex h-10 w-10 items-center justify-center rounded-xl" style={{ color: tone, backgroundColor: `color-mix(in srgb, ${tone} 13%, transparent)` }}>
          <Icon className="h-5 w-5" strokeWidth={1.7} />
        </span>
        <h2 className="text-display font-medium">{headline}</h2>
        <p className="mt-2 text-[0.96875rem] text-muted-foreground">{detail}</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {reviewTo && (
          <Button asChild variant="primary" size="lg">
            <Link to={reviewTo}>Review {plural(reviewCount, 'it', 'them')}</Link>
          </Button>
        )}
        <Button asChild variant="ghost" size="lg">
          <Link to="/inbox">Open inbox</Link>
        </Button>
      </div>
    </section>
  );
}

/* ─── breakdown donut ─────────────────────────────────────────────────────── */

function Breakdown({ counts, total, scanned, safeRate }) {
  const slices = [
    { key: 'safe', label: CATEGORY_LABELS.safe, value: (counts.safe ?? 0) + (counts.reviewed_safe ?? 0) },
    { key: 'suspicious', label: CATEGORY_LABELS.suspicious, value: counts.needs_review ?? 0 },
    { key: 'likely_phishing', label: CATEGORY_LABELS.likely_phishing, value: counts.quarantine ?? 0 },
    { key: 'confirmed_phishing', label: 'Confirmed by you', value: counts.confirmed_phishing ?? 0 },
  ];
  const sum = slices.reduce((a, s) => a + s.value, 0);
  const gap = sum > 0 && slices.filter((s) => s.value > 0).length > 1 ? 1.2 : 0;

  let offset = 0;
  const arcs = slices
    .filter((s) => s.value > 0)
    .map((s) => {
      const len = (s.value / sum) * 100;
      const arc = { ...s, dash: Math.max(len - gap, 0.6), offset };
      offset += len;
      return arc;
    });

  return (
    <section className="card flex min-w-0 flex-col justify-center p-6 md:px-8">
      <div className="grid items-center gap-7 sm:grid-cols-[148px_minmax(0,1fr)]">
        <div className="relative mx-auto h-[148px] w-[148px]" role="img" aria-label={`Safe rate ${safeRate} percent. ${scanned === 0 ? 'Nothing scanned yet' : getPostureLabel(safeRate)}.`}>
          <svg viewBox="0 0 148 148" className="h-full w-full -rotate-90">
            <circle cx="74" cy="74" r="62" fill="none" stroke="rgb(255 255 255 / 0.06)" strokeWidth="12" />
            {arcs.map((a) => (
              <circle key={a.key} cx="74" cy="74" r="62" fill="none" strokeWidth="12" pathLength="100" strokeDasharray={`${a.dash} 100`} strokeDashoffset={-a.offset} style={{ stroke: CATEGORY_COLORS[a.key] }} />
            ))}
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="data text-[2.125rem] font-medium leading-none tracking-[-0.03em]">{scanned === 0 ? '–' : `${safeRate}%`}</span>
            <span className="mt-1 text-[0.8125rem] text-muted-foreground-subtle">safe</span>
          </div>
        </div>
        <div>
          <ul className="grid gap-3">
            {slices.map((s) => (
              <li key={s.key} className="grid grid-cols-[8px_minmax(0,1fr)_auto] items-center gap-3 text-[0.90625rem] text-muted-foreground">
                <span className="h-2 w-2 rounded-full" style={{ backgroundColor: CATEGORY_COLORS[s.key] }} />
                {s.label}
                <span className="data font-medium text-foreground">{s.value}</span>
              </li>
            ))}
          </ul>
          <p className="mt-4 text-[0.8125rem] text-muted-foreground-subtle">
            {total > scanned ? `Scanned ${scanned} of ${total} synced` : `${scanned} ${plural(scanned, 'message', 'messages')} scanned`}
          </p>
        </div>
      </div>
    </section>
  );
}

/* ─── flagged per day ─────────────────────────────────────────────────────── */

const SERIES = [
  { key: 'needs_review', category: 'suspicious' },
  { key: 'quarantine', category: 'likely_phishing' },
  { key: 'confirmed_phishing', category: 'confirmed_phishing' },
];

function FlaggedPerDay({ data, loading, label }) {
  const days = data.map((d) => ({ date: d.date, values: SERIES.map((s) => Number(d?.[s.key]) || 0) }));
  const totals = days.map((d) => d.values.reduce((a, b) => a + b, 0));
  const total = totals.reduce((a, b) => a + b, 0);
  const peak = Math.max(1, ...totals);

  const W = 1000;
  const H = 120;
  const slot = days.length > 0 ? W / days.length : W;
  const bw = Math.min(slot * 0.5, 22);
  const last = days.length - 1;
  // Up to five labels, never two on the same day (short ranges would collide).
  const ticks = [...new Set([0, Math.round(last / 4), Math.round(last / 2), Math.round((last * 3) / 4), last])].filter((t) => t >= 0);
  const todayKey = new Date().toLocaleDateString('en-CA');

  return (
    <Card
      title="Flagged per day"
      aside={
        total > 0 && (
          <div className="flex flex-wrap justify-end gap-x-4 gap-y-1 text-[0.8125rem] text-muted-foreground-subtle max-sm:hidden">
            {SERIES.map((s) => (
              <span key={s.key} className="inline-flex items-center gap-2">
                <span className="h-2 w-2 rounded-[2px]" style={{ backgroundColor: CATEGORY_COLORS[s.category] }} />
                {s.category === 'confirmed_phishing' ? 'Confirmed' : CATEGORY_LABELS[s.category]}
              </span>
            ))}
          </div>
        )
      }
    >
      {loading ? (
        <Skeleton className="h-32 w-full" />
      ) : total === 0 ? (
        <Quiet>Nothing was flagged in this range.</Quiet>
      ) : (
        <>
          <p className="-mt-2 mb-5 text-[0.8125rem] text-muted-foreground-subtle">
            {total} flagged in the {label.toLowerCase()}
          </p>
          <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="h-[120px] w-full" role="img" aria-label={`${total} messages flagged in the ${label.toLowerCase()}`}>
            <line x1="0" y1={H / 2} x2={W} y2={H / 2} stroke="rgb(255 255 255 / 0.05)" vectorEffect="non-scaling-stroke" />
            {days.map((d, i) => {
              const x = i * slot + (slot - bw) / 2;
              if (totals[i] === 0) return <rect key={d.date} x={x} y={H - 2} width={bw} height="2" rx="1" fill="rgb(255 255 255 / 0.08)" />;
              let y = H;
              const top = H - (totals[i] / peak) * (H - 4);
              return (
                <g key={d.date}>
                  <title>{`${formatAxisDate(d.date)}: ${SERIES.map((s, j) => `${d.values[j]} ${CATEGORY_LABELS[s.category].toLowerCase()}`).join(', ')}`}</title>
                  <clipPath id={`bar-${i}`}>
                    <rect x={x} y={top} width={bw} height={H - top} rx="3.5" />
                  </clipPath>
                  <g clipPath={`url(#bar-${i})`}>
                    {SERIES.map((s, j) => {
                      const h = (d.values[j] / peak) * (H - 4);
                      if (h <= 0) return null;
                      y -= h;
                      return <rect key={s.key} x={x} y={y} width={bw} height={h} style={{ fill: CATEGORY_COLORS[s.category] }} />;
                    })}
                  </g>
                </g>
              );
            })}
          </svg>
          <div className="relative mt-2.5 h-4 text-xs text-muted-foreground-subtle">
            {ticks.map((t) => (
              <span
                key={t}
                className="absolute top-0 whitespace-nowrap"
                style={t === 0 ? { left: 0 } : t === last ? { right: 0 } : { left: `${((t + 0.5) / days.length) * 100}%`, transform: 'translateX(-50%)' }}
              >
                {t === last && days[t].date === todayKey ? 'Today' : formatAxisDate(days[t].date)}
              </span>
            ))}
          </div>
        </>
      )}
    </Card>
  );
}

/* ─── needs your review ───────────────────────────────────────────────────── */

function ReviewQueue({ emails, loading }) {
  const ordered = useMemo(
    () => [...emails].sort((a, b) => (scoreOf(b) ?? -1) - (scoreOf(a) ?? -1) || receivedAtMs(b) - receivedAtMs(a)),
    [emails]
  );
  const shown = ordered.slice(0, 5);

  return (
    <Card
      title="Needs your review"
      aside={
        ordered.length > shown.length && (
          <Link to="/inbox?riskBucket=quarantine" className="focus-ring rounded text-sm font-medium text-link hover:underline">
            All {ordered.length}
          </Link>
        )
      }
    >
      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-11 w-full" />
          ))}
        </div>
      ) : shown.length === 0 ? (
        <Quiet>Nothing needs your attention right now. Anything that looks like phishing shows up here first.</Quiet>
      ) : (
        <ul className="-mx-2">
          {shown.map((email) => {
            const score = scoreOf(email);
            const color = isScored(score) ? getRiskTextColor(score) : 'var(--color-risk-unscanned)';
            return (
              <li key={emailId(email)}>
                <Link
                  // Opens THIS message with the queue's filter still applied.
                  to={`/inbox?riskBucket=quarantine&selected=${encodeURIComponent(emailId(email))}`}
                  className="focus-ring grid grid-cols-[2.25rem_minmax(0,1fr)_auto] items-center gap-3.5 rounded-xl px-2 py-2.5 transition-colors hover:bg-white/[0.035]"
                >
                  <Avatar name={getSenderName(email)} />
                  <span className="min-w-0">
                    <span className="block truncate text-[0.90625rem] font-semibold">{getSenderName(email)}</span>
                    <span className="block truncate text-sm text-muted-foreground">{email.subject || 'No subject'}</span>
                  </span>
                  <span className="data rounded-full px-2.5 py-0.5 text-[0.8125rem] font-semibold" style={{ color, backgroundColor: `color-mix(in srgb, ${color} 13%, transparent)` }}>
                    {isScored(score) ? score : '–'}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

/* ─── where it came from ──────────────────────────────────────────────────── */

const DOMAIN_SEGMENTS = [
  { key: 'needsReview', category: 'suspicious' },
  { key: 'quarantine', category: 'likely_phishing' },
  { key: 'confirmedPhishing', category: 'confirmed_phishing' },
];

function Sources({ senders, loading }) {
  const list = (Array.isArray(senders) ? senders : []).slice(0, 5);
  const max = list.reduce((acc, s) => Math.max(acc, s.total || 0), 0);

  return (
    <Card title="Where it came from">
      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-9 w-full" />
          ))}
        </div>
      ) : list.length === 0 ? (
        <Quiet>No domain sent you anything suspicious in this range.</Quiet>
      ) : (
        <ul className="-mx-2">
          {list.map((sender) => {
            const total = sender.total || 0;
            return (
              <li key={sender.domain}>
                <Link to={`/inbox?q=${encodeURIComponent(sender.domain)}`} className="focus-ring block rounded-xl px-2 py-2.5 transition-colors hover:bg-white/[0.035]">
                  <span className="flex items-baseline justify-between gap-4 text-[0.90625rem]">
                    <span className="truncate font-medium">{sender.domain}</span>
                    <span className="data text-muted-foreground">{total}</span>
                  </span>
                  <span className="mt-2 flex h-1.5 overflow-hidden rounded-full bg-white/[0.06]" style={{ width: `${max > 0 ? Math.max((total / max) * 100, 4) : 0}%` }}>
                    {DOMAIN_SEGMENTS.map(({ key, category }) => {
                      const count = sender[key] ?? 0;
                      return count > 0 && total > 0 ? <span key={key} className="h-full" style={{ width: `${(count / total) * 100}%`, backgroundColor: CATEGORY_COLORS[category] }} /> : null;
                    })}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

/* ─── page ────────────────────────────────────────────────────────────────── */

export function DashboardPage() {
  const { user } = useAuth();
  const { isConnected, syncVersion, sync, syncing } = useMailAccount();
  const { label, from, to } = useTimeRange();
  const [searchParams, setSearchParams] = useSearchParams();

  const statsQuery = useApi(() => getEmailStats({ from, to }), [syncVersion, from, to], `dash-stats-${from}-${to}-${syncVersion}`);
  const riskyQuery = useApi(() => getEmails({ riskBucket: 'quarantine', from, to }), [syncVersion, from, to], `risky-${from}-${to}-${syncVersion}`);
  const trendQuery = useApi(() => getEmailTrend({ from, to }), [syncVersion, from, to], `dash-trend-${from}-${to}-${syncVersion}`);
  const sendersQuery = useApi(() => getTopRiskySenders({ from, to }), [syncVersion, from, to], `dash-senders-${from}-${to}-${syncVersion}`);

  const sendReport = useAsyncAction(sendReportSummary);
  const [reportSent, setReportSent] = useState(false);

  useEffect(() => setReportSent(false), [from, to]);

  const handleSendReport = async () => {
    try {
      const result = await sendReport.run({ from, to, label });
      if (result?.sent) {
        setReportSent(true);
        toast.success(`Report sent to ${result.recipient}`);
      }
    } catch (err) {
      toast.error(err?.message || 'Could not send the report. Check your email settings.');
    }
  };

  // Strip the OAuth return parameters once the Google round-trip lands here.
  useEffect(() => {
    if (searchParams.get('gmail')) {
      const next = new URLSearchParams(searchParams);
      ['gmail', 'account', 'code'].forEach((k) => next.delete(k));
      setSearchParams(next, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  const firstName = (user?.name || '').trim().split(/\s+/)[0] || 'there';

  const counts = statsQuery.data?.counts || {};
  const total = statsQuery.data?.total ?? 0;
  const safeCount = (counts.safe || 0) + (counts.reviewed_safe || 0);
  const scanned = Math.max(0, total - (counts.unscanned || 0));
  const safeRate = scanned > 0 ? Math.round((safeCount / scanned) * 100) : 0;

  return (
    <PagePanel>
      <div className="mx-auto w-full max-w-[90rem] px-5 pb-12 pt-6 md:px-11 md:pt-9">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-h1 font-medium">
              {greeting()}, {firstName}
            </h1>
            <p className="mt-1 text-[0.9375rem] text-muted-foreground">Your inbox over the {label.toLowerCase()}.</p>
          </div>
          {isConnected && (
            <div className="flex items-center gap-1">
              <TimeRangeFilter />
              <Button variant="ghost" size="icon" aria-label={reportSent ? 'Report sent' : 'Email me this report'} title="Email me this report" onClick={handleSendReport} disabled={sendReport.loading || !statsQuery.data}>
                {sendReport.loading ? <Loader2 className="animate-spin" /> : reportSent ? <Check /> : <Send />}
              </Button>
              <Button variant="ghost" size="icon" aria-label="Refresh" title="Refresh" onClick={() => sync?.()} disabled={syncing}>
                <RefreshCw className={cn(syncing && 'animate-spin')} />
              </Button>
            </div>
          )}
        </header>

        {!isConnected ? (
          <ConnectGmailState compact />
        ) : statsQuery.loading ? (
          <div className="mt-7">
            <BriefingSkeleton />
          </div>
        ) : statsQuery.error ? (
          <ErrorState message={statsQuery.error} onRetry={statsQuery.reload} />
        ) : (
          <div className="mt-7 grid gap-4">
            <div className="grid gap-4 lg:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)]">
              <Hero counts={counts} total={total} scanned={scanned} safeRate={safeRate} />
              <Breakdown counts={counts} total={total} scanned={scanned} safeRate={safeRate} />
            </div>
            <FlaggedPerDay data={Array.isArray(trendQuery.data) ? trendQuery.data : []} loading={trendQuery.loading} label={label} />
            <div className="grid gap-4 lg:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)]">
              <ReviewQueue emails={normalizeEmailList(riskyQuery.data)} loading={riskyQuery.loading} />
              <Sources senders={sendersQuery.data} loading={sendersQuery.loading} />
            </div>
          </div>
        )}
      </div>
    </PagePanel>
  );
}
