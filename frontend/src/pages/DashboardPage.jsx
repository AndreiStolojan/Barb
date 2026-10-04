// ─────────────────────────────────────────────────────────────────────────────
// DashboardPage.jsx — the briefing.
//
// The inbox is where the work happens; this screen answers two questions
// before you go there: "am I safe right now?" and "what needs me first?".
// Four blocks, separated by hairlines, in that order:
//   1. Posture        — safe rate, a sentence, the key counts
//   2. Needs your review — the likely-phishing queue, most urgent first
//   3. Risk over time — flagged messages per day in the selected range
//   4. Where the risky mail came from — attacking domains
//
// Category colour comes from lib/risk.js; a numeric score is coloured from
// the continuous ramp in lib/scoreScale.js. Never a raw hex here.
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Check, Loader2, RefreshCw, Send } from 'lucide-react';
import { toast } from 'sonner';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

import { BriefingSkeleton, ConnectGmailState, ErrorState } from '@/components/common/states';
import { PostureGauge } from '@/components/dashboard/PostureGauge';
import { TimeRangeFilter } from '@/components/common/TimeRangeFilter';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useApi } from '@/hooks/useApi';
import { useAsyncAction } from '@/hooks/useAsyncAction';
import { useMailAccount } from '@/context/MailAccountContext';
import { useTimeRange } from '@/context/TimeRangeContext';
import { getEmails, getEmailStats, getEmailTrend, getTopRiskySenders } from '@/api/emailsApi';
import { sendReportSummary } from '@/api/reportsApi';
import { normalizeEmailList } from '@/lib/email-list';
import { emailId, getSenderAddress, getSenderName } from '@/lib/email';
import { CATEGORY_COLORS, CATEGORY_LABELS } from '@/lib/risk';
import { getPostureLabel, getRiskColor, getRiskTextColor, isScored, UNSCORED_COLOR } from '@/lib/scoreScale';
import { formatDateTime } from '@/utils/formatDate';
import { cn } from '@/lib/utils';

/* ─── helpers ─────────────────────────────────────────────────────────────── */

const formatAxisDate = (dateStr) => {
  if (!dateStr) return '';
  const d = new Date(`${dateStr}T00:00:00`);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};

const relativeTime = (value) => {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const diffMin = Math.round((Date.now() - date.getTime()) / 60000);
  if (diffMin < 1) return 'now';
  if (diffMin < 60) return `${diffMin}m`;
  const diffHours = Math.round(diffMin / 60);
  if (diffHours < 24) return `${diffHours}h`;
  const diffDays = Math.round(diffHours / 24);
  if (diffDays < 30) return `${diffDays}d`;
  return formatAxisDate(date.toISOString().slice(0, 10));
};

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

const plural = (n, one, many) => (n === 1 ? one : many);

/* ─── block scaffolding ───────────────────────────────────────────────────── */

function Block({ title, note, children }) {
  return (
    <section className="border-t border-border py-8">
      <div className="mb-5 flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <h2 className="text-h3 font-semibold">{title}</h2>
        {note && <span className="ml-auto text-xs text-muted-foreground">{note}</span>}
      </div>
      {children}
    </section>
  );
}

const Note = ({ children }) => (
  <p className="max-w-[56ch] text-[0.8125rem] leading-relaxed text-muted-foreground">{children}</p>
);

/* ─── 1. posture ──────────────────────────────────────────────────────────── */

function Figure({ value, label, color }) {
  return (
    <div className="min-w-0">
      <span className="data block text-[1.5rem] font-medium leading-none" style={color ? { color } : undefined}>
        {value}
      </span>
      <span className="mt-1.5 block text-xs text-muted-foreground">{label}</span>
    </div>
  );
}

function postureDetail({ scanned, total, needsReview, quarantine, confirmed }) {
  if (scanned === 0) {
    return total > 0
      ? 'None of the synced messages have been scanned yet, so there is nothing to judge.'
      : 'Nothing has been synced for this time range yet.';
  }
  if (quarantine > 0) {
    const head = `${quarantine} ${plural(quarantine, 'message looks', 'messages look')} like phishing`;
    const tail = needsReview > 0 ? `, and ${needsReview} more ${plural(needsReview, 'is', 'are')} worth a second look.` : '.';
    return `${head}${tail} Start with the queue below.`;
  }
  if (needsReview > 0) {
    return `${needsReview} ${plural(needsReview, 'message has', 'messages have')} suspicious patterns, but nothing here looks like an outright phishing attempt.`;
  }
  if (confirmed > 0) {
    return `Every message scanned in this range came back clean. The ${confirmed} you marked as phishing ${plural(confirmed, 'is', 'are')} already handled.`;
  }
  return `All ${scanned} scanned ${plural(scanned, 'message', 'messages')} came back clean.`;
}

function PostureBlock({ counts, total, scanned, safeRate, periodLabel }) {
  const needsReview = counts.needs_review ?? 0;
  const quarantine = counts.quarantine ?? 0;
  const confirmed = counts.confirmed_phishing ?? 0;
  const reviewedSafe = counts.reviewed_safe ?? 0;

  return (
    <Block title="Posture" note={periodLabel}>
      <div className="grid items-center gap-8 md:grid-cols-[168px_minmax(0,1fr)] md:gap-12">
        <PostureGauge value={safeRate} />

        <div className="min-w-0">
          <p className="text-h1 font-semibold">{scanned === 0 ? 'Nothing to report yet' : getPostureLabel(safeRate)}</p>
          <p className="mt-2 max-w-[56ch] text-[0.8125rem] leading-relaxed text-muted-foreground">
            {postureDetail({ scanned, total, needsReview, quarantine, confirmed })}
          </p>

          <div className="mt-6 grid grid-cols-2 gap-x-6 gap-y-5 border-t border-border pt-5 sm:grid-cols-3 lg:grid-cols-5">
            <Figure value={scanned} label={total > scanned ? `Scanned, of ${total} synced` : `Scanned ${plural(scanned, 'message', 'messages')}`} />
            <Figure value={needsReview} label="Suspicious" color={needsReview > 0 ? CATEGORY_COLORS.suspicious : undefined} />
            <Figure value={quarantine} label="Likely phishing" color={quarantine > 0 ? CATEGORY_COLORS.likely_phishing : undefined} />
            <Figure value={confirmed} label="Confirmed by you" color={confirmed > 0 ? CATEGORY_COLORS.confirmed_phishing : undefined} />
            <Figure value={reviewedSafe} label="Cleared by you" />
          </div>
        </div>
      </div>
    </Block>
  );
}

/* ─── 2. review queue ─────────────────────────────────────────────────────── */

const QUEUE_GRID =
  'grid grid-cols-[minmax(0,1.1fr)_minmax(0,1.6fr)_7rem_3rem] items-center gap-x-5 ' +
  'max-md:grid-cols-[minmax(0,1fr)_7rem] max-md:gap-x-4 max-md:gap-y-1.5';

function QueueRow({ email }) {
  const score = scoreOf(email);
  const scored = isScored(score);
  const barColor = scored ? getRiskColor(score) : UNSCORED_COLOR;
  const scoreColor = scored ? getRiskTextColor(score) : UNSCORED_COLOR;
  const address = getSenderAddress(email);

  return (
    <Link
      // Opens THIS message with the queue's filter still applied, so the list
      // beside it is the rest of the queue.
      to={`/inbox?riskBucket=quarantine&selected=${encodeURIComponent(emailId(email))}`}
      className={cn(QUEUE_GRID, 'focus-ring -mx-2 rounded-md border-b border-border px-2 py-2.5 transition-colors hover:bg-white/[0.04]')}
    >
      <div className="min-w-0">
        <span className="block truncate text-[0.8125rem] font-medium">{getSenderName(email)}</span>
        <span className="data block truncate text-xs text-muted-foreground">{address || 'no sender address'}</span>
      </div>

      <span className="truncate text-[0.8125rem] text-foreground/85 max-md:order-3 max-md:col-span-full">
        {email.subject || 'No subject'}
      </span>

      <div className="flex items-center gap-2.5">
        <span className="relative h-[3px] min-w-0 flex-1 overflow-hidden rounded-full bg-white/[0.1]">
          <i className="absolute inset-y-0 left-0 block rounded-full" style={{ width: `${score ?? 0}%`, backgroundColor: barColor }} />
        </span>
        <span className="data w-6 shrink-0 text-right text-[0.8125rem] font-medium" style={{ color: scoreColor }}>
          {scored ? score : '–'}
        </span>
      </div>

      <span className="data truncate text-right text-xs text-muted-foreground max-md:hidden">{relativeTime(email.receivedAt)}</span>
    </Link>
  );
}

function ReviewQueueBlock({ emails, loading }) {
  const ordered = useMemo(
    () => [...emails].sort((a, b) => (scoreOf(b) ?? -1) - (scoreOf(a) ?? -1) || receivedAtMs(b) - receivedAtMs(a)),
    [emails]
  );
  const total = ordered.length;
  const shown = ordered.slice(0, 6);

  return (
    <Block
      title="Needs your review"
      note={loading ? undefined : total > shown.length ? `${shown.length} most urgent of ${total}` : total > 0 ? 'Most urgent first' : undefined}
    >
      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-9 w-full" />
          ))}
        </div>
      ) : total === 0 ? (
        <Note>Nothing needs your attention right now. Anything that looks like phishing will show up here first.</Note>
      ) : (
        <>
          <div className={cn(QUEUE_GRID, '-mx-2 border-b border-border px-2 pb-2 max-md:hidden')}>
            {['Sender', 'Subject', 'Risk', ''].map((h, i) => (
              <span key={i} className={cn('text-xs text-muted-foreground', i === 3 && 'text-right')}>{h}</span>
            ))}
          </div>
          {shown.map((email) => (
            <QueueRow key={emailId(email)} email={email} />
          ))}
          {total > shown.length && (
            <Link to="/inbox?riskBucket=quarantine" className="focus-ring mt-4 inline-block rounded text-xs text-link underline-offset-4 hover:underline">
              Open all {total} in the inbox
            </Link>
          )}
        </>
      )}
    </Block>
  );
}

/* ─── 3. trend ────────────────────────────────────────────────────────────── */

const TREND_SERIES = [
  { key: 'needs_review', name: CATEGORY_LABELS.suspicious, color: CATEGORY_COLORS.suspicious },
  { key: 'quarantine', name: CATEGORY_LABELS.likely_phishing, color: CATEGORY_COLORS.likely_phishing },
  { key: 'confirmed_phishing', name: CATEGORY_LABELS.confirmed_phishing, color: CATEGORY_COLORS.confirmed_phishing },
];

function TrendTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-md border border-border-strong bg-popover px-3 py-2 text-xs shadow-md">
      <p className="data mb-1.5 text-muted-foreground">{formatAxisDate(label)}</p>
      {TREND_SERIES.map(({ key, name, color }) => {
        const val = payload.find((e) => e.dataKey === key)?.value ?? 0;
        return (
          <div key={key} className="flex items-center justify-between gap-5 py-0.5">
            <span className="flex items-center gap-2 text-muted-foreground">
              <span className="inline-block h-0.5 w-3 rounded-full" style={{ background: color }} />
              {name}
            </span>
            <span className={cn('data font-medium', val === 0 ? 'text-muted-foreground-subtle' : 'text-foreground')}>{val}</span>
          </div>
        );
      })}
    </div>
  );
}

function TrendBlock({ data, loading }) {
  const hasDetections = data.some((d) => TREND_SERIES.some(({ key }) => Number(d?.[key]) > 0));
  const tickFormatter = (value, index) => (index % 5 === 0 ? formatAxisDate(value) : '');

  return (
    <Block title="Risk over time" note="Flagged messages per day">
      {loading ? (
        <Skeleton className="h-48 w-full" />
      ) : data.length === 0 || !hasDetections ? (
        <Note>No message was flagged on any day in this range, so there is no trend to plot yet.</Note>
      ) : (
        <>
          <div className="mb-4 flex flex-wrap gap-x-5 gap-y-1.5">
            {TREND_SERIES.map(({ key, name, color }) => (
              <span key={key} className="inline-flex items-center gap-2 text-xs text-muted-foreground">
                <span className="inline-block h-0.5 w-3 rounded-full" style={{ background: color }} />
                {name}
              </span>
            ))}
          </div>
          <div className="w-full select-none">
            <ResponsiveContainer width="100%" height={200}>
              <LineChart accessibilityLayer={false} data={data} margin={{ top: 6, right: 4, left: -28, bottom: 0 }}>
                <CartesianGrid vertical={false} stroke="rgb(255 255 255 / 0.08)" />
                <XAxis dataKey="date" tickFormatter={tickFormatter} tick={{ fontSize: 11, fill: 'var(--color-muted-foreground-subtle)', fontFamily: 'var(--font-mono)' }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: 'var(--color-muted-foreground-subtle)', fontFamily: 'var(--font-mono)' }} axisLine={false} tickLine={false} allowDecimals={false} />
                <Tooltip content={<TrendTooltip />} cursor={{ stroke: 'rgb(255 255 255 / 0.2)' }} />
                {TREND_SERIES.map(({ key, name, color }) => (
                  <Line key={key} type="monotone" dataKey={key} name={name} stroke={color} strokeWidth={1.5} dot={false} activeDot={{ r: 3, strokeWidth: 0 }} isAnimationActive={false} />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
        </>
      )}
    </Block>
  );
}

/* ─── 4. attacking domains ────────────────────────────────────────────────── */

const DOMAIN_SEGMENTS = [
  { key: 'needsReview', label: 'suspicious', color: CATEGORY_COLORS.suspicious },
  { key: 'quarantine', label: 'likely phishing', color: CATEGORY_COLORS.likely_phishing },
  { key: 'confirmedPhishing', label: 'confirmed', color: CATEGORY_COLORS.confirmed_phishing },
];

function DomainRow({ sender, max }) {
  const total = sender.total || 0;
  const barWidth = max > 0 ? (total / max) * 100 : 0;

  return (
    <Link
      to={`/inbox?q=${encodeURIComponent(sender.domain)}`}
      className={cn(
        'focus-ring -mx-2 grid grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)_4rem] items-center gap-x-6 rounded-md border-b border-border px-2 py-2.5 transition-colors hover:bg-white/[0.04]',
        'max-md:grid-cols-[minmax(0,1fr)_4rem] max-md:gap-y-1.5'
      )}
    >
      <span className="data truncate text-[0.8125rem]">{sender.domain}</span>

      <div className="min-w-0 max-md:order-3 max-md:col-span-full">
        <div className="flex h-[5px] overflow-hidden rounded-full bg-white/[0.08]" style={{ width: `${barWidth}%` }}>
          {DOMAIN_SEGMENTS.map(({ key, color }) => {
            const count = sender[key] ?? 0;
            if (!count || !total) return null;
            return <span key={key} className="h-full" style={{ width: `${(count / total) * 100}%`, backgroundColor: color }} />;
          })}
        </div>
        <div className="mt-1.5 flex flex-wrap gap-x-3 text-xs text-muted-foreground">
          {DOMAIN_SEGMENTS.filter(({ key }) => (sender[key] ?? 0) > 0).map(({ key, label }) => (
            <span key={key}>
              <b className="data font-medium text-foreground">{sender[key]}</b> {label}
            </span>
          ))}
        </div>
      </div>

      <span className="data text-right text-[0.8125rem]">
        <b className="font-medium">{total}</b>
        <span className="text-muted-foreground"> {plural(total, 'msg', 'msgs')}</span>
      </span>
    </Link>
  );
}

function DomainsBlock({ senders, loading }) {
  const list = Array.isArray(senders) ? senders : [];
  const max = list.reduce((acc, s) => Math.max(acc, s.total || 0), 0);

  return (
    <Block title="Where the risky mail came from" note={list.length > 0 ? 'Bars are relative to the busiest domain' : undefined}>
      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-9 w-full" />
          ))}
        </div>
      ) : list.length === 0 ? (
        <Note>No domain sent you anything suspicious in this range.</Note>
      ) : (
        list.map((sender) => <DomainRow key={sender.domain} sender={sender} max={max} />)
      )}
    </Block>
  );
}

/* ─── page ────────────────────────────────────────────────────────────────── */

export function DashboardPage() {
  const { account, isConnected, syncVersion, sync, syncing } = useMailAccount();
  const { label, from, to } = useTimeRange();
  const [searchParams, setSearchParams] = useSearchParams();

  const statsQuery = useApi(() => getEmailStats({ from, to }), [syncVersion, from, to], `dash-stats-${from}-${to}-${syncVersion}`);
  const riskyQuery = useApi(() => getEmails({ riskBucket: 'quarantine', from, to }), [syncVersion, from, to], `risky-${from}-${to}-${syncVersion}`);
  const trendQuery = useApi(() => getEmailTrend({ from, to }), [syncVersion, from, to], `dash-trend-${from}-${to}-${syncVersion}`);
  const sendersQuery = useApi(() => getTopRiskySenders({ from, to }), [syncVersion, from, to], `dash-senders-${from}-${to}-${syncVersion}`);

  const sendReport = useAsyncAction(sendReportSummary);
  const [reportSentTo, setReportSentTo] = useState(null);

  useEffect(() => setReportSentTo(null), [from, to]);

  const handleSendReport = async () => {
    try {
      const result = await sendReport.run({ from, to, label });
      if (result?.sent) {
        setReportSentTo(result.recipient);
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

  const toolbar = (
    <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-4 md:px-6">
      <h1 className="text-sm font-semibold max-md:hidden">Briefing</h1>
      {isConnected && (
        <div className="ml-auto flex items-center gap-1.5">
          <Button size="sm" onClick={handleSendReport} disabled={sendReport.loading || !statsQuery.data}>
            {sendReport.loading ? <Loader2 className="animate-spin" /> : reportSentTo ? <Check /> : <Send />}
            <span className="max-sm:hidden">{reportSentTo ? 'Sent' : 'Email me this'}</span>
          </Button>
          <TimeRangeFilter size="sm" />
          <Button size="sm" onClick={() => sync?.()} disabled={syncing}>
            <RefreshCw className={cn(syncing && 'animate-spin')} />
            <span className="max-sm:hidden">{syncing ? 'Refreshing…' : 'Refresh'}</span>
          </Button>
        </div>
      )}
    </header>
  );

  if (!isConnected) {
    return (
      <>
        {toolbar}
        <ConnectGmailState />
      </>
    );
  }

  const counts = statsQuery.data?.counts || {};
  const total = statsQuery.data?.total ?? 0;
  const safeCount = (counts.safe || 0) + (counts.reviewed_safe || 0);
  const scanned = Math.max(0, total - (counts.unscanned || 0));
  const safeRate = scanned > 0 ? Math.round((safeCount / scanned) * 100) : 0;
  const lastSynced = account?.lastSyncedAt;

  return (
    <>
      {toolbar}
      <div className="mx-auto w-full max-w-[64rem] px-4 pb-16 md:px-6">
        {statsQuery.loading ? (
          <div className="pt-8">
            <BriefingSkeleton />
          </div>
        ) : statsQuery.error ? (
          <ErrorState message={statsQuery.error} onRetry={statsQuery.reload} />
        ) : (
          <>
            <p className="data py-4 text-xs text-muted-foreground">
              {total === 0 ? `No messages in ${label.toLowerCase()}` : `${scanned} of ${total} ${plural(total, 'message', 'messages')} scanned · ${label.toLowerCase()}`}
              {lastSynced ? ` · synced ${formatDateTime(lastSynced)}` : ''}
            </p>

            <PostureBlock counts={counts} total={total} scanned={scanned} safeRate={safeRate} periodLabel={label} />
            <ReviewQueueBlock emails={normalizeEmailList(riskyQuery.data)} loading={riskyQuery.loading} />
            <TrendBlock data={Array.isArray(trendQuery.data) ? trendQuery.data : []} loading={trendQuery.loading} />
            <DomainsBlock senders={sendersQuery.data} loading={sendersQuery.loading} />
          </>
        )}
      </div>
    </>
  );
}
