import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ReviewActions } from '../../src/components/security/ReviewActions.jsx';
import * as actionsApi from '../../src/api/actionsApi.js';

vi.mock('../../src/api/actionsApi.js', () => ({
  markEmailSafe: vi.fn().mockResolvedValue({ userVerdict: 'safe' }),
  markEmailPhishing: vi.fn().mockResolvedValue({ userVerdict: 'phishing' }),
}));

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

  it('disables a button once the email has that verdict', () => {
    render(<ReviewActions email={{ id: 'e3', userVerdict: 'safe' }} onReviewed={vi.fn()} />);

    expect(screen.getByRole('button', { name: /marked as safe/i })).toBeDisabled();
  });
});
