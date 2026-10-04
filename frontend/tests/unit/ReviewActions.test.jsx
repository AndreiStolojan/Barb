import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ReviewActions } from '../../src/components/security/ReviewActions.jsx';
import * as actionsApi from '../../src/api/actionsApi.js';

// The real API shape: an action summary wrapping the email state.
vi.mock('../../src/api/actionsApi.js', () => ({
  markEmailSafe: vi.fn().mockResolvedValue({ action: 'mark_safe', email: { userVerdict: 'safe' }, providerAction: null }),
  markEmailPhishing: vi.fn().mockResolvedValue({
    action: 'mark_phishing',
    email: { userVerdict: 'phishing' },
    providerAction: { type: 'gmail_move_to_spam', status: 'success' },
  }),
}));

const toast = vi.hoisted(() => ({ success: vi.fn(), warning: vi.fn(), error: vi.fn() }));
vi.mock('sonner', () => ({ toast }));

afterEach(() => {
  vi.clearAllMocks();
});

describe('ReviewActions', () => {
  it('marks an email as safe and reports the result', async () => {
    const onReviewed = vi.fn();
    render(<ReviewActions email={{ id: 'e1' }} onReviewed={onReviewed} />);

    await userEvent.click(screen.getByRole('button', { name: /mark as safe/i }));

    expect(actionsApi.markEmailSafe).toHaveBeenCalledWith('e1');
    await waitFor(() => expect(onReviewed).toHaveBeenCalledTimes(1));
  });

  it('marks an email as phishing', async () => {
    render(<ReviewActions email={{ id: 'e2' }} onReviewed={vi.fn()} />);

    await userEvent.click(screen.getByRole('button', { name: /mark as phishing/i }));

    expect(actionsApi.markEmailPhishing).toHaveBeenCalledWith('e2');
  });

  // The verdict is saved even when Gmail refuses the move; the user must be
  // told the message is still in their inbox rather than see a plain success.
  it('warns when Gmail could not move the message to Spam', async () => {
    actionsApi.markEmailPhishing.mockResolvedValueOnce({
      action: 'mark_phishing',
      email: { userVerdict: 'phishing' },
      providerAction: { type: 'gmail_move_to_spam', status: 'failed', message: 'Token revoked' },
    });
    render(<ReviewActions email={{ id: 'e4', riskBucket: 'quarantine' }} onReviewed={vi.fn()} />);

    await userEvent.click(screen.getByRole('button', { name: /mark as phishing/i }));

    await waitFor(() => expect(toast.warning).toHaveBeenCalledTimes(1));
    expect(toast.success).not.toHaveBeenCalled();
  });

  it('disables a button once the email has that verdict', () => {
    render(<ReviewActions email={{ id: 'e3', userVerdict: 'safe' }} onReviewed={vi.fn()} />);

    expect(screen.getByRole('button', { name: /marked as safe/i })).toBeDisabled();
  });
});
