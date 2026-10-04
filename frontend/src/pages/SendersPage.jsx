// ─────────────────────────────────────────────────────────────────────────────
// SendersPage.jsx — the permanent calls you have made about who writes to you.
//
// Two columns face each other, Trusted and Blocked, and the one interaction
// that matters is moving a sender across the gap. Above them, one bar to add
// a rule: type an address or a domain, the bar infers which and says so.
//
// Every rule shows how much mail it touches, broken down by what the scanner
// made of those messages, in the same colours as everywhere else.
// ─────────────────────────────────────────────────────────────────────────────

import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { ArrowLeftRight, AtSign, Globe, Loader2, Plus, Search, ShieldCheck, ShieldOff, Trash2, X } from 'lucide-react';

import { ErrorState } from '@/components/common/states';
import { PagePanel } from '@/components/layout/AppShell';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { useApi, bustCache } from '@/hooks/useApi';
import { useAsyncAction } from '@/hooks/useAsyncAction';
import { addSenderListEntry, getSenderLists, removeSenderListEntry } from '@/api/senderListsApi';
import { CATEGORY_COLORS, CATEGORY_LABELS } from '@/lib/risk';
import { cn } from '@/lib/utils';

const plural = (n, one, many) => (n === 1 ? one : many);
const OPPOSITE = { allow: 'block', block: 'allow' };

const COLUMNS = {
  allow: {
    key: 'allow',
    label: 'Trusted',
    icon: ShieldCheck,
    text: 'text-risk-safe',
    semantics: 'Urgency and similar signals count for less. Password requests and dangerous attachments still count in full.',
  },
  block: {
    key: 'block',
    label: 'Blocked',
    icon: ShieldOff,
    text: 'text-risk-quarantine',
    semantics: 'Always flagged as likely phishing, whatever else the scan finds.',
  },
};

const inferKind = (value) => (value.includes('@') ? 'sender' : 'domain');

const kindHint = (kind, value) => {
  const clean = value.trim().toLowerCase().replace(/^www\./, '');
  if (!clean) return 'An address covers one sender. A bare domain covers everyone at it.';
  return kind === 'sender'
    ? 'One sender: this exact address only. It wins over any rule on its domain.'
    : `Whole domain: also covers mail.${clean}, but not evil-${clean}.`;
};

/* ─── impact ──────────────────────────────────────────────────────────────── */

const BUCKET_TO_CATEGORY = {
  safe: 'safe',
  reviewed_safe: 'safe',
  needs_review: 'suspicious',
  quarantine: 'likely_phishing',
  confirmed_phishing: 'confirmed_phishing',
  unscanned: 'unscanned',
};
const CATEGORIES = ['safe', 'suspicious', 'likely_phishing', 'confirmed_phishing', 'unscanned'];

const emptyCategories = () => Object.fromEntries(CATEGORIES.map((k) => [k, 0]));

const toCategories = (byBucket) => {
  const counts = emptyCategories();
  for (const [bucket, value] of Object.entries(byBucket || {})) {
    const category = BUCKET_TO_CATEGORY[bucket];
    if (category) counts[category] += value || 0;
  }
  return counts;
};

const sumCategories = (entries) =>
  entries.reduce((acc, entry) => {
    const counts = toCategories(entry.matchedByBucket);
    for (const key of CATEGORIES) acc[key] += counts[key];
    return acc;
  }, emptyCategories());

const totalOf = (categories) => CATEGORIES.reduce((sum, key) => sum + categories[key], 0);

const describe = (categories, total) =>
  total === 0 ? 'No messages' : CATEGORIES.filter((k) => categories[k] > 0).map((k) => `${categories[k]} ${CATEGORY_LABELS[k].toLowerCase()}`).join(', ');

function CategoryBar({ categories, total, width = 100, className, title }) {
  return (
    <div
      className={cn('h-1.5 overflow-hidden rounded-full bg-white/[0.06]', className)}
      style={{ width: `${Math.max(width, total > 0 ? 3 : 0)}%` }}
      role="img"
      aria-label={`${title ? `${title}: ` : ''}${describe(categories, total)}`}
    >
      <div className="flex h-full w-full">
        {CATEGORIES.map((key) => {
          const count = categories[key] || 0;
          if (!count || !total) return null;
          return <span key={key} className="h-full" style={{ width: `${(count / total) * 100}%`, backgroundColor: CATEGORY_COLORS[key] }} />;
        })}
      </div>
    </div>
  );
}

function Legend({ categories }) {
  return (
    <ul className="flex flex-wrap items-center gap-x-4 gap-y-1">
      {CATEGORIES.filter((key) => categories[key] > 0).map((key) => {
        const count = categories[key] || 0;
        return (
          <li key={key} className={cn('flex items-center gap-1.5 text-[0.8125rem]', count > 0 ? 'text-muted-foreground' : 'text-muted-foreground-subtle')}>
            <span aria-hidden="true" className="h-2 w-2 rounded-[2px]" style={{ backgroundColor: CATEGORY_COLORS[key], opacity: count > 0 ? 1 : 0.35 }} />
            <b className="data font-medium text-foreground">{count}</b>
            {CATEGORY_LABELS[key]}
          </li>
        );
      })}
    </ul>
  );
}

/* ─── add bar ─────────────────────────────────────────────────────────────── */

function Segmented({ options, value, onChange, ariaLabel }) {
  return (
    <div role="radiogroup" aria-label={ariaLabel} className="flex shrink-0 items-center rounded-[0.625rem] bg-white/[0.04] p-[3px] shadow-[inset_0_0_0_1px_var(--color-input)]">
      {options.map((option) => {
        const active = option.key === value;
        return (
          <button
            key={option.key}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(option.key)}
            className={cn(
              'focus-ring rounded-[0.4375rem] px-3 py-1.5 text-[0.8125rem] transition-colors',
              active ? cn('bg-white/[0.1] font-medium', option.text || 'text-foreground') : 'text-muted-foreground hover:text-foreground'
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

function AddBar({ value, setValue, listType, setListType, kind, kindOverridden, setKind, onAdd, loading }) {
  const canSubmit = Boolean(value.trim()) && !loading;
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (canSubmit) onAdd();
      }}
    >
      <div className="flex flex-wrap items-center gap-2">
        <Segmented
          ariaLabel="Trust or block"
          value={listType}
          onChange={setListType}
          options={[
            { key: 'allow', label: 'Trust', text: 'text-risk-safe' },
            { key: 'block', label: 'Block', text: 'text-risk-quarantine' },
          ]}
        />
        <Input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          aria-label="Address or domain"
          placeholder="name@example.com or example.com"
          className="h-10 min-w-0 flex-1 basis-64"
        />
        <Segmented
          ariaLabel="What the rule covers"
          value={kind}
          onChange={setKind}
          options={[
            { key: 'sender', label: 'Sender' },
            { key: 'domain', label: 'Domain' },
          ]}
        />
        <Button type="submit" variant="primary" size="lg" disabled={!canSubmit}>
          {loading ? <Loader2 className="animate-spin" /> : <Plus />}
          Add rule
        </Button>
      </div>
      <p className="mt-2.5 text-[0.8125rem] text-muted-foreground-subtle">
        {kindHint(kind, value)}
        {kindOverridden && value.trim() && <span className="text-muted-foreground-subtle"> · set by you</span>}
      </p>
    </form>
  );
}

/* ─── rows and columns ────────────────────────────────────────────────────── */

function SenderRow({ entry, busy, maxMatches, onMove, onRemove }) {
  const matched = entry.matchedEmails ?? 0;
  const categories = toCategories(entry.matchedByBucket);
  const toColumn = COLUMNS[OPPOSITE[entry.listType]];

  return (
    <li className={cn('group -mx-2 grid grid-cols-[2.25rem_minmax(0,1fr)_auto] items-center gap-3 rounded-xl px-2 py-2.5 transition-colors hover:bg-white/[0.035]', busy && 'opacity-60')}>
      <span aria-hidden="true" className="flex h-9 w-9 items-center justify-center rounded-full bg-white/[0.07] text-muted-foreground">
        {entry.kind === 'domain' ? <Globe className="h-4 w-4" /> : <AtSign className="h-4 w-4" />}
      </span>
      <div className="min-w-0">
        <span className="block truncate text-[0.90625rem] font-medium" title={entry.value}>
          {entry.value}
        </span>
        <span className="mt-0.5 flex items-center gap-2 text-[0.8125rem] text-muted-foreground-subtle">
          <span>{entry.kind === 'domain' ? 'whole domain' : 'single sender'}</span>
          <span aria-hidden="true" className="text-muted-foreground-subtle">·</span>
          {matched > 0 ? (
            <span className="data">{matched} {plural(matched, 'message', 'messages')}</span>
          ) : (
            <span className="text-muted-foreground-subtle">no messages yet</span>
          )}
        </span>
        {matched > 0 && <CategoryBar categories={categories} total={matched} width={(matched / maxMatches) * 100} title={entry.value} className="mt-1.5" />}
      </div>

      <div className={cn('flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100', busy && 'opacity-100')}>
        {busy ? (
          <span className="p-1.5" role="status" aria-label="Working…">
            <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
          </span>
        ) : (
          <>
            <button type="button" aria-label={`Move ${entry.value} to ${toColumn.label}`} title={`Move to ${toColumn.label}`} onClick={() => onMove(entry)} className="focus-ring rounded-lg p-2 text-muted-foreground hover:bg-white/[0.07] hover:text-foreground">
              <ArrowLeftRight className="h-4 w-4" />
            </button>
            <button type="button" aria-label={`Remove ${entry.value}`} title="Remove" onClick={() => onRemove(entry)} className="focus-ring rounded-lg p-2 text-muted-foreground hover:bg-white/[0.07] hover:text-risk-phishing">
              <Trash2 className="h-4 w-4" />
            </button>
          </>
        )}
      </div>
    </li>
  );
}

function Column({ column, entries, filtered, maxMatches, busyId, onMove, onRemove }) {
  const Icon = column.icon;
  const categories = useMemo(() => sumCategories(entries), [entries]);
  const total = totalOf(categories);

  return (
    <section className="card min-w-0 p-5 md:px-[26px] md:py-6">
      <header className="mb-3">
        <div className="flex items-center gap-2.5">
          <span className={cn('flex h-8 w-8 items-center justify-center rounded-[0.625rem]', column.key === 'allow' ? 'bg-risk-safe-soft' : 'bg-risk-quarantine-soft')}>
            <Icon className={cn('h-4 w-4', column.text)} aria-hidden="true" />
          </span>
          <h2 className="text-[0.9375rem] font-semibold">{column.label}</h2>
          <span className="data ml-auto text-sm text-muted-foreground-subtle">{entries.length}</span>
        </div>
        <p className="mt-2.5 text-[0.8125rem] leading-relaxed text-muted-foreground">{column.semantics}</p>
        {entries.length > 0 && total > 0 && <CategoryBar categories={categories} total={total} title={column.label} className="mt-3.5" />}
      </header>

      {entries.length === 0 ? (
        <p className="py-4 text-sm leading-relaxed text-muted-foreground-subtle">
          {filtered ? 'Nothing here matches that search.' : column.key === 'block' ? 'Nobody blocked yet.' : 'Nobody trusted yet.'}
        </p>
      ) : (
        <ul>
          {entries.map((entry) => (
            <SenderRow key={entry.id} entry={entry} busy={busyId === entry.id} maxMatches={maxMatches} onMove={onMove} onRemove={onRemove} />
          ))}
        </ul>
      )}
    </section>
  );
}

/* ─── page ────────────────────────────────────────────────────────────────── */

export function SendersPage() {
  const { data, loading, error, reload } = useApi(() => getSenderLists({ withMatchCounts: true }), [], 'sender-lists-full');
  const entries = useMemo(() => data?.entries || [], [data]);

  const [listType, setListType] = useState('allow');
  const [value, setValue] = useState('');
  const [kindOverride, setKindOverride] = useState(null);
  const [search, setSearch] = useState('');
  const [busyId, setBusyId] = useState(null);

  const kind = kindOverride ?? inferKind(value);

  const handleValueChange = (next) => {
    setValue(next);
    if (kindOverride && inferKind(next) !== inferKind(value)) setKindOverride(null);
  };

  const refresh = async () => {
    bustCache('sender-lists', 'sender-lists-full');
    await reload();
  };

  const add = useAsyncAction(async () => {
    await addSenderListEntry({ listType, kind, value: value.trim() });
    setValue('');
    setKindOverride(null);
    await refresh();
    toast.success(listType === 'allow' ? 'Added to Trusted' : 'Added to Blocked');
  });

  const handleRemove = async (entry) => {
    setBusyId(entry.id);
    try {
      await removeSenderListEntry(entry.id);
      await refresh();
      toast.success('Rule removed');
    } catch (e) {
      toast.error(e.message || 'Could not remove the rule.');
    } finally {
      setBusyId(null);
    }
  };

  // No move endpoint: remove, then add on the other side. The server refuses a
  // value that exists on both lists, so add-first would always fail.
  const handleMove = async (entry) => {
    const to = OPPOSITE[entry.listType];
    const payload = { kind: entry.kind, value: entry.value };
    setBusyId(entry.id);
    try {
      await removeSenderListEntry(entry.id);
    } catch (e) {
      toast.error(e.message || `Could not move ${entry.value}.`);
      setBusyId(null);
      return;
    }
    try {
      await addSenderListEntry({ listType: to, ...payload });
      toast.success(`${entry.value} moved to ${COLUMNS[to].label}`);
    } catch (e) {
      try {
        await addSenderListEntry({ listType: entry.listType, ...payload });
        toast.error(`Could not move ${entry.value}. It is still ${COLUMNS[entry.listType].label.toLowerCase()}. ${e.message || ''}`.trim());
      } catch {
        toast.error(`${entry.value} was removed and could not be added back. Add it again above.`);
      }
    } finally {
      await refresh();
      setBusyId(null);
    }
  };

  const query = search.trim().toLowerCase();
  const visible = query ? entries.filter((e) => e.value.includes(query)) : entries;
  const trusted = visible.filter((e) => e.listType === 'allow');
  const blocked = visible.filter((e) => e.listType === 'block');
  const maxMatches = Math.max(1, ...entries.map((e) => e.matchedEmails ?? 0));
  const boardCategories = useMemo(() => sumCategories(visible), [visible]);
  const boardTotal = totalOf(boardCategories);
  const pending = loading && entries.length === 0;

  return (
    <PagePanel>
      <div className="mx-auto w-full max-w-[90rem] px-5 pb-12 pt-6 md:px-11 md:pt-9">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-h1 font-medium">Senders</h1>
            <p className="mt-1 text-[0.9375rem] text-muted-foreground">People and domains you have already made a call on.</p>
          </div>
          <div className="relative w-full max-w-64">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground-subtle" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search rules" placeholder="Search rules" className="pl-9 pr-9" />
            {search && (
              <button type="button" onClick={() => setSearch('')} aria-label="Clear search" className="focus-ring absolute right-2.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground-subtle hover:text-foreground">
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
        </header>

        <section className="card mt-7 p-5 md:px-[26px] md:py-6">
          <h2 className="mb-3.5 text-[0.9375rem] font-semibold">Add a rule</h2>
          <AddBar value={value} setValue={handleValueChange} listType={listType} setListType={setListType} kind={kind} kindOverridden={kindOverride !== null} setKind={setKindOverride} onAdd={() => add.run().catch((e) => toast.error(e.message || 'Could not add the rule.'))} loading={add.loading} />
        </section>

        {!pending && !error && boardTotal > 0 && (
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2 px-1 pb-1 pt-5">
            <p className="text-[0.8125rem] text-muted-foreground">
              Your rules cover <b className="data font-medium text-foreground">{boardTotal}</b> {plural(boardTotal, 'message', 'messages')}
              {query && ' matching your search'}
            </p>
            <Legend categories={boardCategories} />
          </div>
        )}

        <div className="mt-4 grid items-start gap-4 lg:grid-cols-2">
          {pending ? (
            [0, 1].map((i) => <Skeleton key={i} className="h-60 rounded-[1.25rem]" />)
          ) : error ? (
            <div className="col-span-full">
              <ErrorState message={error} onRetry={reload} />
            </div>
          ) : (
            <>
              <Column column={COLUMNS.allow} entries={trusted} filtered={Boolean(query)} maxMatches={maxMatches} busyId={busyId} onMove={handleMove} onRemove={handleRemove} />
              <Column column={COLUMNS.block} entries={blocked} filtered={Boolean(query)} maxMatches={maxMatches} busyId={busyId} onMove={handleMove} onRemove={handleRemove} />
            </>
          )}
        </div>
      </div>
    </PagePanel>
  );
}

export default SendersPage;
