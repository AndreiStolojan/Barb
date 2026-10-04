import { act, renderHook, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { MailAccountProvider, useMailAccount } from '../../src/context/MailAccountContext.jsx';

const api = vi.hoisted(() => ({ historyId: '100', syncResult: { insertedCount: 0, updatedCount: 0 } }));
vi.mock('../../src/api/mailAccountsApi', () => ({
  getMailAccounts: async () => [{ _id: 'acc-1', lastHistoryId: api.historyId }],
  syncMailAccount: async () => api.syncResult,
}));

const renderContext = async () => {
  const hook = renderHook(() => useMailAccount(), { wrapper: MailAccountProvider });
  await waitFor(() => expect(hook.result.current.isConnected).toBe(true));
  return hook;
};

// Every bump reruns all dashboard aggregations, so an idle poll must not bump.
it('a background poll refreshes pages only when the mailbox changed', async () => {
  const hook = await renderContext();

  await act(() => hook.result.current.sync({ silent: true }));
  expect(hook.result.current.syncVersion).toBe(0);

  // The server's own cron ingested mail between two polls.
  api.historyId = '101';
  await act(() => hook.result.current.sync({ silent: true }));
  expect(hook.result.current.syncVersion).toBe(1);
});

it('a manual sync always refreshes pages', async () => {
  const hook = await renderContext();

  await act(() => hook.result.current.sync());
  expect(hook.result.current.syncVersion).toBe(1);
});
