// Gmail's REST calls and Mongo writes deliberately live outside this module.
// Keeping the state machine injected makes cursor ordering testable without a
// database or a live Gmail account.

const HISTORY_TYPES = ['messageAdded', 'messageDeleted', 'labelAdded', 'labelRemoved'];

const asId = (value) => {
    if (typeof value === 'string' && value) return value;
    if (value?.id) return String(value.id);
    return null;
};

const asIdSet = (values) => new Set(
    (values instanceof Set ? [...values] : values || [])
        .map(asId)
        .filter(Boolean)
);

const isInboxLabelChange = (change) =>
    Array.isArray(change?.labelIds) && change.labelIds.includes('INBOX');

const isHistoryGap = (error) => error?.statusCode === 404 || error?.status === 404;

const clockMs = (clock) => {
    const value = clock();
    return value instanceof Date ? value.getTime() : Number(value);
};

const compactResult = ({ mode, counts, syncErrors, ...rest }) => ({
    mode,
    fetchedCount: counts.fetchedCount,
    insertedCount: counts.insertedCount,
    updatedCount: counts.updatedCount,
    skippedCount: counts.skippedCount,
    syncErrors,
    ...rest,
});

const mergeProcessResult = (counts, syncErrors, result = {}) => {
    counts.insertedCount += Number(result.insertedCount) || 0;
    counts.updatedCount += Number(result.updatedCount) || 0;
    counts.skippedCount += Number(result.skippedCount) || 0;
    if (Array.isArray(result.syncErrors)) syncErrors.push(...result.syncErrors);
    return result.persisted !== false;
};

const addHistoryChanges = ({ history, additions, inboxStates }) => {
    for (const record of history || []) {
        for (const entry of record.messagesAdded || []) {
            const id = asId(entry.message);
            if (!id || !entry.message?.labelIds?.includes('INBOX')) continue;
            inboxStates.set(id, 'present');
            additions.set(id, entry.message);
        }

        for (const entry of record.labelsAdded || []) {
            const id = asId(entry.message);
            if (!id || !isInboxLabelChange(entry)) continue;
            inboxStates.set(id, 'present');
            additions.set(id, entry.message);
        }

        for (const entry of record.messagesDeleted || []) {
            const id = asId(entry.message);
            if (!id) continue;
            inboxStates.set(id, 'removed');
            additions.delete(id);
        }

        for (const entry of record.labelsRemoved || []) {
            const id = asId(entry.message);
            if (!id || !isInboxLabelChange(entry)) continue;
            inboxStates.set(id, 'removed');
            additions.delete(id);
        }
    }
};

/**
 * Creates the Gmail cursor state machine. updateAccount is expected to perform
 * a conditional write for lockOwner and return the updated account (or throw
 * when that conditional write no longer matches).
 */
export const createGmailSyncStateMachine = (deps) => {
    const {
        request,
        processMessageIds,
        processExistingMessageIds = async () => ({ persisted: true }),
        findExistingMessages,
        setInboxStates,
        updateAccount,
        heartbeat = async () => {},
        metrics = {},
        clock = () => Date.now(),
        caps = {},
    } = deps;

    const backfillMaxMessages = Math.max(1, Number(caps.backfillMaxMessages) || 500);
    const backfillMaxDurationMs = Math.max(1, Number(caps.backfillMaxDurationMs) || 90_000);
    const recordSync = metrics.recordSync || (() => {});
    const incrementMessagesIngested = metrics.incrementMessagesIngested || (() => {});
    const incrementHistoryGap = metrics.incrementHistoryGap || (() => {});
    const recordIngested = (counts) => incrementMessagesIngested(counts.insertedCount);

    const assertUpdated = async ({ mailAccount, lockOwner, patch }) => {
        const updated = await updateAccount({ mailAccount, lockOwner, patch });
        if (!updated) {
            const error = new Error('Gmail sync lock was lost before the account state could be saved');
            error.code = 'GMAIL_SYNC_LOCK_LOST';
            throw error;
        }
        return updated;
    };

    const getProfile = async (mailAccount) => {
        const profile = await request({ type: 'profile', mailAccount });
        if (!profile?.historyId) {
            throw new Error('Gmail profile response did not include a historyId');
        }
        return String(profile.historyId);
    };

    const processOnlyMissing = async ({ mailAccount, messageIds, syncSource, counts, syncErrors }) => {
        const ids = [...new Set(messageIds.filter(Boolean))];
        if (ids.length === 0) return { missingIds: [], persisted: true };

        const existingIds = asIdSet(await findExistingMessages({ mailAccount, messageIds: ids }));
        const existingResult = await processExistingMessageIds({
            mailAccount,
            messageIds: [...existingIds],
            syncSource,
        });
        if (!mergeProcessResult(counts, syncErrors, existingResult)) {
            return { missingIds: [], persisted: false };
        }
        const missingIds = ids.filter((id) => !existingIds.has(id));
        if (missingIds.length === 0) return { missingIds, persisted: true };

        const result = await processMessageIds({
            mailAccount,
            messageIds: missingIds,
            syncSource,
        });
        return {
            missingIds,
            persisted: mergeProcessResult(counts, syncErrors, result),
        };
    };

    // Lists INBOX messages newer than backfillAfter, then hands off to history
    // sync. The floor is stored so a capped run resumes the same bounded query.
    const runBackfill = async ({ mailAccount, lockOwner, mode, resetAnchor }) => {
        let account = mailAccount;
        const counts = { fetchedCount: 0, insertedCount: 0, updatedCount: 0, skippedCount: 0 };
        const syncErrors = [];
        const startedAt = clockMs(clock);

        if (resetAnchor) {
            const historyId = await getProfile(account);
            account = await assertUpdated({
                mailAccount: account,
                lockOwner,
                patch: {
                    syncState: 'backfilling',
                    lastHistoryId: historyId,
                    backfillPageToken: null,
                    // SecureInbox never reads mail received before the account
                    // was connected. Already stored messages are skipped below.
                    backfillAfter: new Date(account.createdAt ?? clockMs(clock)),
                    backfillCompletedAt: null,
                },
            });
        }

        let pageToken = account.backfillPageToken || null;
        while (counts.fetchedCount < backfillMaxMessages) {
            if (clockMs(clock) - startedAt >= backfillMaxDurationMs) {
                recordIngested(counts);
                recordSync({ mode, result: 'success' });
                return compactResult({ mode, counts, syncErrors, completed: false, reason: 'wall_clock_cap' });
            }

            await heartbeat({ mailAccount: account, lockOwner });
            const remaining = backfillMaxMessages - counts.fetchedCount;
            const page = await request({
                type: 'messages.list',
                mailAccount: account,
                pageToken,
                maxResults: Math.min(
                    Math.min(50, Math.max(1, Number(account.syncMaxResults) || 10)),
                    remaining
                ),
                labelIds: ['INBOX'],
                after: account.backfillAfter,
            });
            const ids = (page?.messages || []).map(asId).filter(Boolean);
            counts.fetchedCount += ids.length;

            const processed = await processOnlyMissing({
                mailAccount: account,
                messageIds: ids,
                syncSource: mode === 'resync' ? 'gmail_resync' : 'gmail_backfill',
                counts,
                syncErrors,
            });
            if (!processed.persisted) {
                recordIngested(counts);
                recordSync({ mode, result: 'failure' });
                return compactResult({
                    mode,
                    counts,
                    syncErrors,
                    completed: false,
                    failed: true,
                    reason: 'message_persistence_incomplete',
                });
            }

            await setInboxStates({ mailAccount: account, presentIds: ids, removedIds: [] });
            const nextPageToken = page?.nextPageToken || null;
            const completed = !nextPageToken;
            const capped = counts.fetchedCount >= backfillMaxMessages;
            const now = new Date(clockMs(clock));
            account = await assertUpdated({
                mailAccount: account,
                lockOwner,
                patch: completed
                    ? {
                          syncState: 'incremental',
                          backfillPageToken: null,
                          backfillAfter: null,
                          backfillCompletedAt: now,
                          lastFullSyncAt: now,
                          lastSyncedAt: now,
                      }
                    : {
                          syncState: 'backfilling',
                          backfillPageToken: nextPageToken,
                          lastSyncedAt: now,
                      },
            });

            if (completed || capped) {
                recordIngested(counts);
                recordSync({ mode, result: 'success' });
                return compactResult({ mode, counts, syncErrors, completed });
            }
            pageToken = nextPageToken;
        }

    };

    const runIncremental = async ({ mailAccount, lockOwner }) => {
        let account = mailAccount;
        const counts = { fetchedCount: 0, insertedCount: 0, updatedCount: 0, skippedCount: 0 };
        const syncErrors = [];
        const additions = new Map();
        const inboxStates = new Map();
        let pageToken = null;
        let finalHistoryId = null;

        try {
            do {
                await heartbeat({ mailAccount: account, lockOwner });
                const page = await request({
                    type: 'history.list',
                    mailAccount: account,
                    startHistoryId: account.lastHistoryId,
                    pageToken,
                    historyTypes: HISTORY_TYPES,
                });
                addHistoryChanges({ history: page?.history, additions, inboxStates });
                finalHistoryId = page?.historyId ? String(page.historyId) : finalHistoryId;
                pageToken = page?.nextPageToken || null;
            } while (pageToken);
        } catch (error) {
            if (!isHistoryGap(error)) throw error;
            await assertUpdated({
                mailAccount: account,
                lockOwner,
                patch: { syncState: 'resync_required' },
            });
            incrementHistoryGap();
            recordIngested(counts);
            recordSync({ mode: 'incremental', result: 'success' });
            return compactResult({
                mode: 'incremental',
                counts,
                syncErrors,
                completed: false,
                reason: 'history_gap',
            });
        }

        // additions is a Map specifically so duplicate history entries retain
        // Gmail's first-seen order while later removals/re-additions determine
        // the final membership.
        const presentIds = [];
        const removedIds = [];
        for (const id of additions.keys()) {
            if (inboxStates.get(id) === 'present') presentIds.push(id);
        }
        for (const [id, state] of inboxStates) {
            if (state === 'removed') removedIds.push(id);
        }
        counts.fetchedCount = presentIds.length;

        const existingIds = asIdSet(await findExistingMessages({
            mailAccount: account,
            messageIds: presentIds,
        }));
        const missingIds = presentIds.filter((id) => !existingIds.has(id));
        const existingResult = await processExistingMessageIds({
            mailAccount: account,
            messageIds: [...existingIds],
            syncSource: 'gmail_incremental',
        });
        if (!mergeProcessResult(counts, syncErrors, existingResult)) {
            recordIngested(counts);
            recordSync({ mode: 'incremental', result: 'failure' });
            return compactResult({
                mode: 'incremental',
                counts,
                syncErrors,
                completed: false,
                failed: true,
                reason: 'message_persistence_incomplete',
            });
        }
        await setInboxStates({
            mailAccount: account,
            presentIds: presentIds.filter((id) => existingIds.has(id)),
            removedIds,
        });

        if (missingIds.length > 0) {
            const result = await processMessageIds({
                mailAccount: account,
                messageIds: missingIds,
                syncSource: 'gmail_incremental',
            });
            if (!mergeProcessResult(counts, syncErrors, result)) {
                recordIngested(counts);
                recordSync({ mode: 'incremental', result: 'failure' });
                return compactResult({
                    mode: 'incremental',
                    counts,
                    syncErrors,
                    completed: false,
                    failed: true,
                    reason: 'message_persistence_incomplete',
                });
            }
            await setInboxStates({ mailAccount: account, presentIds: missingIds, removedIds: [] });
        }

        const now = new Date(clockMs(clock));
        await assertUpdated({
            mailAccount: account,
            lockOwner,
            patch: {
                lastHistoryId: finalHistoryId || account.lastHistoryId,
                syncState: 'incremental',
                lastSyncedAt: now,
            },
        });
        recordIngested(counts);
        recordSync({ mode: 'incremental', result: 'success' });
        return compactResult({ mode: 'incremental', counts, syncErrors, completed: true });
    };

    return {
        run: async ({ mailAccount, lockOwner, legacyAccount = false, forceBackfill = false }) => {
            let attemptedMode = 'incremental';
            try {
                if (legacyAccount && !forceBackfill) {
                    const historyId = await getProfile(mailAccount);
                    await assertUpdated({
                        mailAccount,
                        lockOwner,
                        patch: {
                            lastHistoryId: historyId,
                            syncState: 'incremental',
                            lastSyncedAt: new Date(clockMs(clock)),
                        },
                    });
                    recordSync({ mode: 'incremental', result: 'success' });
                    return compactResult({
                        mode: 'incremental',
                        counts: { fetchedCount: 0, insertedCount: 0, updatedCount: 0, skippedCount: 0 },
                        syncErrors: [],
                        completed: true,
                        reason: 'legacy_baseline',
                    });
                }

                const state = mailAccount.syncState || 'never_synced';
                if (state === 'backfilling' && mailAccount.backfillAfter) {
                    attemptedMode = 'backfill';
                    return runBackfill({
                        mailAccount,
                        lockOwner,
                        mode: 'backfill',
                        resetAnchor: false,
                    });
                }
                // A 'backfilling' account without a floor started before the
                // floor existed and walks the whole mailbox; restart it bounded.
                if (forceBackfill || ['never_synced', 'backfilling', 'resync_required'].includes(state)) {
                    const mode = state === 'resync_required' ? 'resync' : 'backfill';
                    attemptedMode = mode;
                    return runBackfill({
                        mailAccount,
                        lockOwner,
                        mode,
                        resetAnchor: true,
                    });
                }
                if (!mailAccount.lastHistoryId) {
                    attemptedMode = 'resync';
                    return runBackfill({
                        mailAccount,
                        lockOwner,
                        mode: 'resync',
                        resetAnchor: true,
                    });
                }
                attemptedMode = 'incremental';
                return runIncremental({ mailAccount, lockOwner });
            } catch (error) {
                recordSync({ mode: attemptedMode, result: 'failure' });
                throw error;
            }
        },
    };
};
