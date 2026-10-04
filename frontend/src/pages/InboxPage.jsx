// ─────────────────────────────────────────────────────────────────────────────
// InboxPage.jsx — the triage desk: list on the left, evidence on the right.
//
// The list keeps a fixed width; every extra pixel goes to the evidence pane.
// Selection, filter, search and page all live in the URL, so a link opens the
// exact same screen for someone else.
//
// Keyboard: j/k move the selection, 1–5 switch filters, / focuses search,
// Enter opens the message on a phone, Esc leaves select mode. The message
// actions (s, p, r, v/m/e) are registered by the pane itself.
//
// Mobile: the list fills the screen; a selected message covers it, with a
// Back control. Nothing is auto-selected on a phone.
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { CheckSquare, Loader2, RefreshCw, Search, ShieldCheck, ShieldX, X } from 'lucide-react';
import { toast } from 'sonner';

import { ConnectGmailState, EmptyState, ErrorState, ListSkeleton } from '@/components/common/states';
import { Pagination } from '@/components/common/Pagination';
import { EmailRow } from '@/components/inbox/EmailRow';
import { FilterTabs } from '@/components/inbox/FilterTabs';
import { MessagePane, MessagePaneEmpty } from '@/components/inbox/MessagePane';
import { Button } from '@/components/ui/button';
import { Kbd } from '@/components/ui/kbd';
import { useApi, bustCacheByPrefix } from '@/hooks/useApi';
import { useDebounce } from '@/hooks/useDebounce';
import { useIsDesktop } from '@/hooks/useMediaQuery';
import { useMailAccount } from '@/context/MailAccountContext';
import { useTimeRange } from '@/context/TimeRangeContext';
import { getEmails, getEmailStats } from '@/api/emailsApi';
import { markEmailPhishing, markEmailSafe } from '@/api/actionsApi';
import { useRegisterCommands } from '@/lib/commands';
import { normalizeEmailList } from '@/lib/email-list';
import { emailId } from '@/lib/email';
import { RISK_FILTERS } from '@/lib/risk';
import { getDateGroupLabel } from '@/utils/formatDate';
import { cn } from '@/lib/utils';

const PAGE_SIZE = 10;
const LIST_WIDTH = '23rem';
const DATE_GROUP_ORDER = ['Today', 'Yesterday', 'This week', 'Older'];

function groupByDate(emails) {
  const groups = {};
  for (const email of emails) {
    const label = getDateGroupLabel(email.receivedAt);
    (groups[label] ||= []).push(email);
  }
  return DATE_GROUP_ORDER.filter((g) => groups[g]?.length > 0).map((g) => ({ label: g, emails: groups[g] }));
}

const FILTER_COUNT_MAP = { '': '__total__', quarantine: 'quarantine', needs_review: 'needs_review', confirmed_phishing: 'confirmed_phishing', safe: 'safe' };

export function InboxPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { isConnected, syncVersion, sync, syncing } = useMailAccount();
  const { from, to } = useTimeRange();
  const isDesktop = useIsDesktop();
  const searchRef = useRef(null);
  const listRef = useRef(null);

  const riskBucket = searchParams.get('riskBucket') || '';
  const rawSearch = searchParams.get('q') || '';
  const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
  const selectedParam = searchParams.get('selected') || '';

  const [searchInput, setSearchInput] = useState(rawSearch);
  const debouncedSearch = useDebounce(searchInput, 300);

  const [selectMode, setSelectMode] = useState(false);
  const [checkedIds, setCheckedIds] = useState(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);

  const cacheKey = `inbox-${from}-${to}-${syncVersion}-${riskBucket}-${debouncedSearch}-${page}`;
  const { data, loading, error, reload } = useApi(
    () => getEmails({ ...(riskBucket ? { riskBucket } : {}), ...(debouncedSearch ? { q: debouncedSearch } : {}), from, to, page, limit: PAGE_SIZE }),
    [riskBucket, debouncedSearch, page, syncVersion, from, to],
    cacheKey
  );

  // Tab counts are range totals, never narrowed by the search box.
  const countsQuery = useApi(() => getEmailStats({ from, to }), [syncVersion, from, to], `inbox-stats-${from}-${to}-${syncVersion}`);
  const counts = countsQuery.data?.counts || {};
  const totalCount = countsQuery.data?.total ?? 0;
  const showCounts = isConnected && !debouncedSearch;
  const tabCounts = Object.fromEntries(
    RISK_FILTERS.map(({ key }) => [key, FILTER_COUNT_MAP[key] === '__total__' ? totalCount : counts[FILTER_COUNT_MAP[key]] ?? 0])
  );

  const emails = normalizeEmailList(data);
  const totalPages = data?.pagination?.totalPages ?? (emails.length > 0 ? 1 : 0);
  const emailIds = emails.map(emailId);
  const groups = groupByDate(emails);
  const searching = loading || searchInput !== debouncedSearch;

  // An id in the URL wins even when it is not on this page (links from the
  // briefing). On desktop the first row is open by default; on a phone the
  // pane would cover the list, so nothing is auto-selected.
  const selectedId = selectedParam || (isDesktop ? emailIds[0] || '' : '');

  useEffect(() => {
    setSelectMode(false);
    setCheckedIds(new Set());
  }, [riskBucket, debouncedSearch, page, syncVersion]);

  const setParam = (updates, { replace = true } = {}) => {
    const next = new URLSearchParams(searchParams);
    Object.entries(updates).forEach(([k, v]) => (v ? next.set(k, v) : next.delete(k)));
    setSearchParams(next, { replace });
  };

  const setFilter = (key) => setParam({ riskBucket: key, page: '', selected: '' });
  const setPage = (p) => setParam({ page: String(p), selected: '' });
  const selectEmail = (id) => setParam({ selected: id }, { replace: isDesktop });
  const closeMessage = () => setParam({ selected: '' });

  const handleSearchChange = (value) => {
    setSearchInput(value);
    setParam({ q: value, page: '', selected: '' });
  };

  const afterReview = () => {
    reload();
    countsQuery.reload();
    bustCacheByPrefix('inbox-', 'dash-', 'risky-');
  };

  const move = (delta) => {
    if (emailIds.length === 0) return;
    const index = emailIds.indexOf(selectedId);
    const next = index === -1 ? (delta > 0 ? 0 : emailIds.length - 1) : Math.min(emailIds.length - 1, Math.max(0, index + delta));
    const id = emailIds[next];
    setParam({ selected: id });
    listRef.current?.querySelector(`[data-row="${id}"]`)?.scrollIntoView({ block: 'nearest' });
  };

  const toggleChecked = (id) =>
    setCheckedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const exitSelectMode = () => {
    setSelectMode(false);
    setCheckedIds(new Set());
  };

  const runBulk = async (fn, label) => {
    if (checkedIds.size === 0) return;
    setBulkBusy(true);
    try {
      await Promise.all([...checkedIds].map((id) => fn(id)));
      toast.success(`${checkedIds.size} ${checkedIds.size === 1 ? 'message' : 'messages'} ${label}`);
      exitSelectMode();
      afterReview();
    } catch (err) {
      toast.error(err?.message || 'Something went wrong.');
    } finally {
      setBulkBusy(false);
    }
  };

  useRegisterCommands(
    'inbox',
    [
      { id: 'next', label: 'Next message', group: 'Inbox', keys: 'j', run: () => move(1) },
      { id: 'prev', label: 'Previous message', group: 'Inbox', keys: 'k', run: () => move(-1) },
      { id: 'search', label: 'Search messages', group: 'Inbox', keys: '/', run: () => searchRef.current?.focus() },
      { id: 'escape', label: 'Clear search / leave select mode', group: 'Inbox', keys: 'Escape', hidden: true, run: () => { if (document.activeElement === searchRef.current) searchRef.current.blur(); else if (selectMode) exitSelectMode(); else if (!isDesktop) closeMessage(); } },
      { id: 'select-mode', label: selectMode ? 'Leave select mode' : 'Select several messages', group: 'Inbox', keys: 'x', run: () => (selectMode ? exitSelectMode() : setSelectMode(true)) },
      { id: 'refresh', label: 'Refresh inbox', group: 'Inbox', keys: 'g r', run: () => sync?.() },
      ...RISK_FILTERS.map(({ key, label }, i) => ({ id: `filter-${key || 'all'}`, label: `Filter: ${label}`, group: 'Inbox', keys: String(i + 1), run: () => setFilter(key) })),
    ],
    [emailIds.join(','), selectedId, selectMode, isDesktop, sync]
  );

  const showPaneOnMobile = !isDesktop && Boolean(selectedParam);

  return (
    <div className="flex h-[calc(100dvh-3rem)] min-h-0 flex-1 flex-col overflow-hidden md:h-dvh">
      {/* toolbar: only once there is a mailbox to search */}
      <div className={cn('flex h-12 shrink-0 items-center gap-2 border-b border-border px-3 md:px-4', showPaneOnMobile && 'max-md:hidden', !isConnected && 'hidden')}>
        <h1 className="text-sm font-semibold max-md:hidden">Inbox</h1>
        {showCounts && <span className="data text-xs text-muted-foreground max-md:hidden">{totalCount}</span>}

        <div className="relative min-w-0 flex-1 md:ml-2 md:max-w-xs">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground-subtle" />
          <input
            ref={searchRef}
            value={searchInput}
            onChange={(e) => handleSearchChange(e.target.value)}
            placeholder="Search sender, subject…"
            aria-label="Search messages"
            className="focus-ring h-8 w-full rounded-md border border-input bg-transparent pl-8 pr-9 text-xs text-foreground placeholder:text-muted-foreground-subtle hover:border-border-strong"
          />
          <span className="absolute right-2 top-1/2 -translate-y-1/2">
            {searching ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground-subtle" />
            ) : searchInput ? (
              <button type="button" onClick={() => handleSearchChange('')} aria-label="Clear search" className="focus-ring rounded p-0.5 text-muted-foreground-subtle hover:text-foreground">
                <X className="h-3.5 w-3.5" />
              </button>
            ) : (
              <Kbd className="max-md:hidden">/</Kbd>
            )}
          </span>
        </div>

        <div className="ml-auto flex items-center gap-1.5">
          {selectMode ? (
            <Button variant="ghost" size="sm" onClick={exitSelectMode}>Cancel</Button>
          ) : (
            <Button size="sm" onClick={() => setSelectMode(true)} disabled={!isConnected || emails.length === 0}>
              <CheckSquare />
              <span className="max-sm:hidden">Select</span>
            </Button>
          )}
          <Button size="sm" onClick={() => sync?.()} disabled={syncing || !isConnected}>
            <RefreshCw className={cn(syncing && 'animate-spin')} />
            <span className="max-sm:hidden">Refresh</span>
          </Button>
        </div>
      </div>

      {!isConnected ? (
        <ConnectGmailState />
      ) : (
        <>
          <div className={cn(showPaneOnMobile && 'max-md:hidden')}>
            <FilterTabs active={riskBucket} counts={tabCounts} showCounts={showCounts} onSelect={setFilter} />
          </div>

          <div className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-[var(--inbox-list-w)_minmax(0,1fr)]" style={{ '--inbox-list-w': LIST_WIDTH }}>
            <aside ref={listRef} className={cn('flex min-h-0 min-w-0 flex-col overflow-y-auto border-border md:border-r', showPaneOnMobile && 'max-md:hidden')}>
              {loading ? (
                <ListSkeleton />
              ) : error ? (
                <ErrorState message={error} onRetry={reload} />
              ) : emails.length === 0 ? (
                <EmptyState
                  icon={ShieldCheck}
                  title={debouncedSearch ? 'No matches' : riskBucket ? 'Nothing here' : 'No messages in this range'}
                  description={
                    debouncedSearch
                      ? 'No message matches that search in this time range. Try a sender domain or a word from the subject.'
                      : riskBucket
                        ? 'No message in this category for the selected range. That is the good outcome.'
                        : 'Widen the time range from the briefing, or refresh to sync new mail.'
                  }
                />
              ) : (
                <>
                  {groups.map((group) => (
                    <div key={group.label}>
                      <p className="sticky top-0 z-10 bg-background px-[14px] py-1.5 text-[0.6875rem] font-medium text-muted-foreground">{group.label}</p>
                      <div className="divide-y divide-border">
                        {group.emails.map((email) => {
                          const id = emailId(email);
                          return (
                            <div key={id} data-row={id}>
                              <EmailRow
                                email={email}
                                active={!selectMode && id === selectedId}
                                onSelect={selectEmail}
                                checkable={selectMode}
                                checked={checkedIds.has(id)}
                                onCheck={toggleChecked}
                              />
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                  {totalPages > 1 && (
                    <div className="mt-auto border-t border-border">
                      <Pagination page={page} totalPages={totalPages} onPage={setPage} />
                    </div>
                  )}
                </>
              )}
            </aside>

            <section className={cn('min-h-0 min-w-0 overflow-y-auto', !showPaneOnMobile && 'max-md:hidden')} aria-label="Message">
              {selectedId ? <MessagePane id={selectedId} onReviewed={afterReview} onBack={closeMessage} /> : <MessagePaneEmpty />}
            </section>
          </div>
        </>
      )}

      {selectMode && checkedIds.size > 0 && (
        <div className="fixed bottom-20 left-1/2 z-40 flex -translate-x-1/2 items-center gap-1 rounded-lg border border-border-strong bg-popover px-2 py-1.5 shadow-lg md:bottom-6">
          <span className="data px-2 text-xs text-muted-foreground">{checkedIds.size} selected</span>
          <Button variant="ghost" size="sm" disabled={bulkBusy} onClick={() => runBulk(markEmailSafe, 'marked safe')}>
            <ShieldCheck className="text-risk-safe" />
            Mark safe
          </Button>
          <Button variant="ghost" size="sm" disabled={bulkBusy} onClick={() => runBulk(markEmailPhishing, 'marked phishing')} className="text-risk-phishing hover:text-risk-phishing">
            <ShieldX />
            Mark phishing
          </Button>
        </div>
      )}
    </div>
  );
}

export default InboxPage;
