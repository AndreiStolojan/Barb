// ─────────────────────────────────────────────────────────────────────────────
// InboxPage.jsx — the reader: list on the chrome, the message on a raised panel.
//
// The list keeps a fixed width; every extra pixel goes to the reading panel.
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
import { ListChecks, Loader2, RefreshCw, Search, ShieldCheck, ShieldX, X } from 'lucide-react';
import { toast } from 'sonner';

import { ConnectGmailState, EmptyState, ErrorState, ListSkeleton } from '@/components/common/states';
import { Pagination } from '@/components/common/Pagination';
import { EmailRow } from '@/components/inbox/EmailRow';
import { FilterTabs } from '@/components/inbox/FilterTabs';
import { MessagePane, MessagePaneEmpty } from '@/components/inbox/MessagePane';
import { PagePanel } from '@/components/layout/AppShell';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
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
  const [searchOpen, setSearchOpen] = useState(false);
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
  // While a refresh reloads the list, keep showing the message that was open
  // instead of blanking the pane until the new page arrives.
  const lastAutoSelected = useRef('');
  const autoSelected = isDesktop ? emailIds[0] || (loading ? lastAutoSelected.current : '') : '';
  if (autoSelected) lastAutoSelected.current = autoSelected;
  const selectedId = selectedParam || autoSelected;

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

  // The field only exists while searching; open it, then focus once mounted.
  const openSearch = () => {
    setSearchOpen(true);
    requestAnimationFrame(() => searchRef.current?.focus());
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
      const results = await Promise.all([...checkedIds].map((id) => fn(id)));
      toast.success(`${checkedIds.size} ${checkedIds.size === 1 ? 'message' : 'messages'} ${label}`);
      // The verdicts are saved either way; a failed move to Spam is said.
      const notMoved = results.filter((r) => r?.providerAction?.status === 'failed').length;
      if (notMoved > 0) toast.warning(`Gmail did not move ${notMoved} of them to Spam. They are still in your Gmail inbox.`);
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
      { id: 'search', label: 'Search messages', group: 'Inbox', keys: '/', run: openSearch },
      { id: 'escape', label: 'Clear search / leave select mode', group: 'Inbox', keys: 'Escape', hidden: true, run: () => { if (document.activeElement === searchRef.current) { searchRef.current.blur(); if (!searchInput) setSearchOpen(false); } else if (selectMode) exitSelectMode(); else if (!isDesktop) closeMessage(); } },
      { id: 'select-mode', label: selectMode ? 'Leave select mode' : 'Select several messages', group: 'Inbox', keys: 'x', run: () => (selectMode ? exitSelectMode() : setSelectMode(true)) },
      { id: 'refresh', label: 'Refresh inbox', group: 'Inbox', keys: 'g r', run: () => sync?.() },
      ...RISK_FILTERS.map(({ key, label }, i) => ({ id: `filter-${key || 'all'}`, label: `Filter: ${label}`, group: 'Inbox', keys: String(i + 1), run: () => setFilter(key) })),
    ],
    [emailIds.join(','), selectedId, selectMode, isDesktop, sync, searchInput]
  );

  const showPaneOnMobile = !isDesktop && Boolean(selectedParam);
  const searchShown = searchOpen || Boolean(searchInput);

  if (!isConnected) {
    return (
      <PagePanel>
        <ConnectGmailState />
      </PagePanel>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col md:grid md:grid-cols-[23.25rem_minmax(0,1fr)]">
      {/* The list sits on the chrome; only what you read is raised. */}
      <aside className={cn('flex min-h-0 min-w-0 flex-col md:pr-2.5', showPaneOnMobile && 'max-md:hidden')}>
        <div className="flex items-center gap-1 px-3.5 pb-3 pt-1 md:pt-3">
          <h1 className="text-h2 font-semibold max-md:hidden">Inbox</h1>
          <div className="ml-auto flex items-center gap-0.5">
            <Button variant="ghost" size="icon" aria-label="Search messages" onClick={openSearch} className={cn(searchShown && 'text-foreground')}>
              <Search />
            </Button>
            <Button variant="ghost" size="icon" aria-label={selectMode ? 'Leave select mode' : 'Select messages'} onClick={() => (selectMode ? exitSelectMode() : setSelectMode(true))} disabled={emails.length === 0} className={cn(selectMode && 'bg-panel text-foreground')}>
              <ListChecks />
            </Button>
            <Button variant="ghost" size="icon" aria-label="Refresh" onClick={() => sync?.()} disabled={syncing}>
              <RefreshCw className={cn(syncing && 'animate-spin')} />
            </Button>
          </div>
        </div>

        {searchShown && (
          <div className="relative mx-3 mb-3">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground-subtle" />
            <Input
              ref={searchRef}
              value={searchInput}
              onChange={(e) => handleSearchChange(e.target.value)}
              onBlur={() => !searchInput && setSearchOpen(false)}
              placeholder="Search sender or subject"
              aria-label="Search messages"
              className="pl-9 pr-9"
            />
            <span className="absolute right-2.5 top-1/2 -translate-y-1/2">
              {searching ? (
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground-subtle" />
              ) : (
                searchInput && (
                  <button type="button" onClick={() => handleSearchChange('')} aria-label="Clear search" className="focus-ring rounded p-0.5 text-muted-foreground-subtle hover:text-foreground">
                    <X className="h-4 w-4" />
                  </button>
                )
              )}
            </span>
          </div>
        )}

        <FilterTabs active={riskBucket} counts={tabCounts} showCounts={showCounts} onSelect={setFilter} />

        <div ref={listRef} className="mt-2 min-h-0 flex-1 overflow-y-auto px-1 pb-3">
          {loading ? (
            <ListSkeleton />
          ) : error ? (
            <ErrorState message={error} onRetry={reload} />
          ) : emails.length === 0 ? (
            <EmptyState
              title={debouncedSearch ? 'No matches' : riskBucket ? 'Nothing here' : 'No messages yet'}
              description={
                debouncedSearch
                  ? 'Try a sender domain or a word from the subject.'
                  : riskBucket
                    ? 'Nothing in this category for the selected range.'
                    : 'Refresh to sync new mail, or widen the range on the briefing.'
              }
            />
          ) : (
            <>
              {groups.map((group) => (
                <div key={group.label}>
                  <p className="px-3 pb-1.5 pt-3 text-[0.8125rem] text-muted-foreground-subtle">{group.label}</p>
                  {group.emails.map((email) => {
                    const id = emailId(email);
                    return (
                      <div key={id} data-row={id}>
                        <EmailRow email={email} active={!selectMode && id === selectedId} onSelect={selectEmail} checkable={selectMode} checked={checkedIds.has(id)} onCheck={toggleChecked} />
                      </div>
                    );
                  })}
                </div>
              ))}
              {totalPages > 1 && <Pagination page={page} totalPages={totalPages} onPage={setPage} className="mt-2" />}
            </>
          )}
        </div>
      </aside>

      <section aria-label="Message" className={cn('panel min-h-0 min-w-0 md:overflow-y-auto', !showPaneOnMobile && 'max-md:hidden')}>
        {selectedId ? <MessagePane key={selectedId} id={selectedId} onReviewed={afterReview} onBack={closeMessage} onMove={move} /> : <MessagePaneEmpty />}
      </section>

      {selectMode && checkedIds.size > 0 && (
        <div className="fixed bottom-[calc(5rem+env(safe-area-inset-bottom))] left-1/2 z-40 flex -translate-x-1/2 items-center gap-1 rounded-2xl bg-popover p-1.5 pl-4 shadow-lg ring-1 ring-white/[0.06] md:bottom-6">
          <span className="data pr-2 text-sm text-muted-foreground">{checkedIds.size} selected</span>
          <Button variant="ghost" size="sm" disabled={bulkBusy} onClick={() => runBulk(markEmailSafe, 'marked as safe')}>
            <ShieldCheck className="text-risk-safe" />
            Mark as safe
          </Button>
          <Button variant="phish" size="sm" disabled={bulkBusy} onClick={() => runBulk(markEmailPhishing, 'marked as phishing')}>
            <ShieldX />
            Mark as phishing
          </Button>
        </div>
      )}
    </div>
  );
}

export default InboxPage;
