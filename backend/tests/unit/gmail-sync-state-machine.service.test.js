import test from 'node:test';
import assert from 'node:assert/strict';

import { createGmailSyncStateMachine } from '../../src/services/gmail-sync-state-machine.service.js';
import MailAccount from '../../src/models/mail-account.model.js';

const account = (overrides = {}) => ({
    _id: 'account-1',
    syncMaxResults: 50,
    ...overrides,
});

const makeMachine = ({
    responses = [],
    existingIds = [],
    processResult = {},
    now = 1_000,
    caps = {},
    updateAccount: updateAccountImpl,
} = {}) => {
    const calls = { requests: [], processed: [], stateChanges: [], updates: [], metrics: [] };
    const machine = createGmailSyncStateMachine({
        request: async (input) => {
            calls.requests.push(input);
            const response = responses.shift();
            if (response instanceof Error) throw response;
            return response;
        },
        processMessageIds: async (input) => {
            calls.processed.push(input);
            return processResult;
        },
        findExistingMessages: async () => existingIds,
        setInboxStates: async (input) => calls.stateChanges.push(input),
        updateAccount: updateAccountImpl || (async (input) => {
            calls.updates.push(input);
            return { ...input.mailAccount, ...input.patch };
        }),
        heartbeat: async () => {},
        metrics: {
            recordSync: (input) => calls.metrics.push(input),
            incrementMessagesIngested: () => {},
            incrementHistoryGap: () => calls.metrics.push({ historyGap: true }),
        },
        clock: typeof now === 'function' ? now : () => now,
        caps: { backfillMaxMessages: 2, backfillMaxDurationMs: 10_000, ...caps },
    });
    return { machine, calls };
};

test('legacy account captures a profile cursor and enters incremental without backfill', async () => {
    const { machine, calls } = makeMachine({ responses: [{ historyId: 'h-now' }] });

    const result = await machine.run({ mailAccount: account(), lockOwner: 'lock', legacyAccount: true });

    assert.equal(result.reason, 'legacy_baseline');
    assert.equal(calls.requests[0].type, 'profile');
    assert.deepEqual(calls.updates[0].patch.lastHistoryId, 'h-now');
    assert.equal(calls.updates[0].patch.syncState, 'incremental');
});

test('backfill anchors profile first and persists the next token only after its page is processed', async () => {
    const { machine, calls } = makeMachine({
        responses: [
            { historyId: 'anchor' },
            { messages: [{ id: 'one' }, { id: 'two' }], nextPageToken: 'next' },
        ],
        processResult: { insertedCount: 2 },
    });

    const result = await machine.run({ mailAccount: account({ syncState: 'never_synced' }), lockOwner: 'lock' });

    assert.equal(result.mode, 'backfill');
    assert.equal(result.completed, false);
    assert.deepEqual(calls.processed[0].messageIds, ['one', 'two']);
    assert.equal(calls.processed[0].syncSource, 'gmail_backfill');
    assert.equal(calls.updates.at(-1).patch.backfillPageToken, 'next');
    assert.equal(calls.updates.at(-1).patch.syncState, 'backfilling');
});

test('incremental sync consumes all history pages, applies removals, and only fetches missing final additions', async () => {
    const { machine, calls } = makeMachine({
        responses: [
            {
                historyId: 'h-2',
                nextPageToken: 'page-2',
                history: [{
                    messagesAdded: [{ message: { id: 'new', labelIds: ['INBOX'] } }],
                    labelsAdded: [{ message: { id: 'stored' }, labelIds: ['INBOX'] }],
                    labelsRemoved: [{ message: { id: 'gone' }, labelIds: ['INBOX'] }],
                }],
            },
            {
                historyId: 'h-3',
                history: [{
                    messagesDeleted: [{ message: { id: 'new' } }],
                    labelsAdded: [{ message: { id: 'newer' }, labelIds: ['INBOX'] }],
                }],
            },
        ],
        existingIds: ['stored'],
        processResult: { insertedCount: 1 },
    });

    const result = await machine.run({
        mailAccount: account({ syncState: 'incremental', lastHistoryId: 'h-1' }),
        lockOwner: 'lock',
    });

    assert.equal(result.completed, true);
    assert.deepEqual(calls.requests.map((call) => call.historyTypes), [
        ['messageAdded', 'messageDeleted', 'labelAdded', 'labelRemoved'],
        ['messageAdded', 'messageDeleted', 'labelAdded', 'labelRemoved'],
    ]);
    assert.deepEqual(calls.processed[0].messageIds, ['newer']);
    assert.equal(calls.processed[0].syncSource, 'gmail_incremental');
    assert.deepEqual(calls.stateChanges[0], {
        mailAccount: account({ syncState: 'incremental', lastHistoryId: 'h-1' }),
        presentIds: ['stored'],
        removedIds: ['new', 'gone'],
    });
    assert.equal(calls.updates.at(-1).patch.lastHistoryId, 'h-3');
});

test('incomplete incremental persistence leaves the history cursor unchanged for retry', async () => {
    const { machine, calls } = makeMachine({
        responses: [{
            historyId: 'h-2',
            history: [{ messagesAdded: [{ message: { id: 'retry-me', labelIds: ['INBOX'] } }] }],
        }],
        processResult: {
            skippedCount: 1,
            syncErrors: [{ messageId: 'retry-me', stage: 'db_upsert' }],
            persisted: false,
        },
    });

    const result = await machine.run({
        mailAccount: account({ syncState: 'incremental', lastHistoryId: 'h-1' }),
        lockOwner: 'lock',
    });

    assert.equal(result.reason, 'message_persistence_incomplete');
    assert.equal(calls.updates.length, 0);
    assert.equal(result.syncErrors.length, 1);
});

test('an expired history cursor moves to resync_required without throwing', async () => {
    const gap = Object.assign(new Error('history expired'), { statusCode: 404 });
    const { machine, calls } = makeMachine({ responses: [gap] });

    const result = await machine.run({
        mailAccount: account({ syncState: 'incremental', lastHistoryId: 'expired' }),
        lockOwner: 'lock',
    });

    assert.equal(result.reason, 'history_gap');
    assert.equal(calls.updates[0].patch.syncState, 'resync_required');
    assert.deepEqual(calls.metrics.at(-1), { mode: 'incremental', result: 'success' });
});

test('an INBOX labelsRemoved-only history event marks the email removed without processing it', async () => {
    const { machine, calls } = makeMachine({
        responses: [{
            historyId: 'h-2',
            history: [{ labelsRemoved: [{ message: { id: 'moved-to-spam' }, labelIds: ['INBOX'] }] }],
        }],
    });

    const result = await machine.run({
        mailAccount: account({ syncState: 'incremental', lastHistoryId: 'h-1' }),
        lockOwner: 'lock',
    });

    assert.equal(result.completed, true);
    assert.equal(calls.processed.length, 0);
    assert.deepEqual(calls.stateChanges, [{
        mailAccount: account({ syncState: 'incremental', lastHistoryId: 'h-1' }),
        presentIds: [],
        removedIds: ['moved-to-spam'],
    }]);
    assert.equal(calls.updates.at(-1).patch.lastHistoryId, 'h-2');
});

test('an idle incremental mailbox makes exactly one history request', async () => {
    const { machine, calls } = makeMachine({ responses: [{ historyId: 'h-2' }] });

    const result = await machine.run({
        mailAccount: account({ syncState: 'incremental', lastHistoryId: 'h-1' }),
        lockOwner: 'lock',
    });

    assert.equal(result.completed, true);
    assert.equal(calls.requests.length, 1);
    assert.equal(calls.requests[0].type, 'history.list');
    assert.equal(calls.processed.length, 0);
    assert.equal(calls.updates.at(-1).patch.lastHistoryId, 'h-2');
});

test('a backfill resumes at its stored page token without capturing another profile cursor', async () => {
    const { machine, calls } = makeMachine({
        responses: [{ messages: [{ id: 'resumed' }] }],
        processResult: { insertedCount: 1 },
    });

    const result = await machine.run({
        mailAccount: account({
            syncState: 'backfilling',
            lastHistoryId: 'anchored',
            backfillPageToken: 'resume-page',
            backfillAfter: new Date('2026-10-01T00:00:00Z'),
        }),
        lockOwner: 'lock',
    });

    assert.equal(result.completed, true);
    assert.deepEqual(calls.requests.map(({ type }) => type), ['messages.list']);
    assert.equal(calls.requests[0].pageToken, 'resume-page');
    assert.deepEqual(calls.requests[0].after, new Date('2026-10-01T00:00:00Z'));
    assert.equal(calls.processed[0].syncSource, 'gmail_backfill');
});

test('backfill stops at its wall-clock cap after saving the continuation token', async () => {
    const clockValues = [0, 0, 10];
    const { machine, calls } = makeMachine({
        responses: [{ messages: [{ id: 'first' }], nextPageToken: 'next-page' }],
        processResult: { insertedCount: 1 },
        now: () => clockValues.shift() ?? 10,
        caps: { backfillMaxMessages: 50, backfillMaxDurationMs: 10 },
    });

    const result = await machine.run({
        mailAccount: account({
            syncState: 'backfilling',
            backfillPageToken: 'start-page',
            backfillAfter: new Date(0),
        }),
        lockOwner: 'lock',
    });

    assert.equal(result.reason, 'wall_clock_cap');
    assert.equal(result.completed, false);
    assert.equal(calls.requests.length, 1);
    assert.equal(calls.updates.at(-1).patch.backfillPageToken, 'next-page');
});

test('resync_required captures a fresh profile cursor then backfills as gmail_resync', async () => {
    const { machine, calls } = makeMachine({
        responses: [
            { historyId: 'fresh-anchor' },
            { messages: [{ id: 'resynced' }] },
        ],
        processResult: { insertedCount: 1 },
    });

    const result = await machine.run({
        mailAccount: account({ syncState: 'resync_required', lastHistoryId: 'expired' }),
        lockOwner: 'lock',
    });

    assert.equal(result.mode, 'resync');
    assert.deepEqual(calls.requests.map(({ type }) => type), ['profile', 'messages.list']);
    assert.equal(calls.processed[0].syncSource, 'gmail_resync');
    assert.equal(calls.updates[0].patch.lastHistoryId, 'fresh-anchor');
    assert.equal(calls.updates.at(-1).patch.syncState, 'incremental');
});

test('initial backfill retains hydrated MailAccount fields after its profile update', async () => {
    const hydratedAccount = new MailAccount({
        _id: '507f1f77bcf86cd799439011',
        userId: '507f1f77bcf86cd799439012',
        provider: 'gmail',
        accountEmail: 'user@example.com',
        accessToken: 'encrypted-access-token',
        syncState: 'never_synced',
    });
    const { machine, calls } = makeMachine({
        responses: [
            { historyId: 'anchored-history' },
            { messages: [] },
        ],
        updateAccount: async ({ mailAccount, patch }) => {
            mailAccount.set(patch);
            return mailAccount;
        },
    });

    await machine.run({ mailAccount: hydratedAccount, lockOwner: 'lock' });

    const listRequestAccount = calls.requests[1].mailAccount;
    assert.equal(calls.requests[1].type, 'messages.list');
    assert.equal(String(listRequestAccount._id), String(hydratedAccount._id));
    assert.equal(listRequestAccount.accessToken, 'encrypted-access-token');
    assert.equal(listRequestAccount.lastHistoryId, 'anchored-history');
});

test('initial backfill lists only mail received after the account was connected', async () => {
    const connectedAt = new Date('2026-10-01T08:00:00Z');
    const { machine, calls } = makeMachine({
        responses: [{ historyId: 'anchor' }, { messages: [] }],
    });

    await machine.run({
        mailAccount: account({ syncState: 'never_synced', createdAt: connectedAt }),
        lockOwner: 'lock',
    });

    assert.deepEqual(calls.updates[0].patch.backfillAfter, connectedAt);
    assert.deepEqual(calls.requests[1].after, connectedAt);
    assert.equal(calls.updates.at(-1).patch.backfillAfter, null);
});

test('resync lists from a day before the last sync, never before connection', async () => {
    const connectedAt = new Date('2026-09-01T00:00:00Z');
    const lastSyncedAt = new Date('2026-10-01T12:00:00Z');
    const { machine, calls } = makeMachine({
        responses: [{ historyId: 'anchor' }, { messages: [] }],
    });

    await machine.run({
        mailAccount: account({
            syncState: 'resync_required',
            lastHistoryId: 'expired',
            createdAt: connectedAt,
            lastSyncedAt,
        }),
        lockOwner: 'lock',
    });

    assert.deepEqual(calls.requests[1].after, new Date('2026-09-30T12:00:00Z'));
});

test('an unbounded backfill from before the floor restarts bounded instead of resuming', async () => {
    const connectedAt = new Date('2026-10-01T08:00:00Z');
    const { machine, calls } = makeMachine({
        responses: [{ historyId: 'fresh-anchor' }, { messages: [] }],
    });

    await machine.run({
        mailAccount: account({
            syncState: 'backfilling',
            lastHistoryId: 'old-anchor',
            backfillPageToken: 'years-old-page',
            createdAt: connectedAt,
        }),
        lockOwner: 'lock',
    });

    assert.deepEqual(calls.requests.map(({ type }) => type), ['profile', 'messages.list']);
    assert.equal(calls.requests[1].pageToken, null);
    assert.deepEqual(calls.requests[1].after, connectedAt);
});
