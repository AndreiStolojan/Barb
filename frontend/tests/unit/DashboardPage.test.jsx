import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

// Mutable fixtures so each test can decide what the dashboard is given.
const api = vi.hoisted(() => ({
  stats: { counts: {}, total: 0 },
  emails: { items: [], pagination: { totalPages: 0 } },
  trend: [],
  senders: [],
}));

// Connected account so the dashboard renders its full body (not the connect prompt).
vi.mock('../../src/context/MailAccountContext.jsx', () => ({
  useMailAccount: () => ({
    account: { lastSyncedAt: null },
    isConnected: true,
    syncVersion: 0,
  }),
}));

vi.mock('../../src/api/emailsApi.js', () => ({
  getEmailStats: vi.fn(() => Promise.resolve(api.stats)),
  getEmails: vi.fn(() => Promise.resolve(api.emails)),
  getEmailTrend: vi.fn(() => Promise.resolve(api.trend)),
  getTopRiskySenders: vi.fn(() => Promise.resolve(api.senders)),
}));

vi.mock('../../src/api/reportsApi.js', () => ({
  getReportSummary: vi.fn(() => Promise.resolve({ topTriggeredRules: [] })),
  sendReportSummary: vi.fn(() => Promise.resolve({ sent: false })),
}));

import { bustCacheByPrefix } from '../../src/hooks/useApi.js';
import { TimeRangeProvider } from '../../src/context/TimeRangeContext.jsx';
import { AuthProvider } from '../../src/context/AuthContext.jsx';
import { DashboardPage } from '../../src/pages/DashboardPage.jsx';

const renderDashboard = () =>
  render(
    <MemoryRouter>
      <AuthProvider>
        <TimeRangeProvider>
          <DashboardPage />
        </TimeRangeProvider>
      </AuthProvider>
    </MemoryRouter>
  );

describe('DashboardPage', () => {
  beforeEach(() => {
    api.stats = { counts: {}, total: 0 };
    api.emails = { items: [], pagination: { totalPages: 0 } };
    api.trend = [];
    api.senders = [];
    // useApi keeps a module-level stale-while-revalidate cache keyed by range;
    // every test here uses the same range, so clear it or one test renders the
    // previous test's data.
    bustCacheByPrefix('dash-', 'risky-');
  });

  // Guards against a render-time crash in the dashboard (e.g. a dropped hook
  // destructure) — the kind that compiles and passes other unit tests but blanks
  // the page at runtime.
  it('renders the loaded dashboard without crashing', async () => {
    renderDashboard();
    expect(await screen.findByRole('heading', { name: 'Briefing' })).toBeTruthy();
  });

  it('renders the four briefing blocks in priority order', async () => {
    renderDashboard();
    await screen.findByRole('heading', { name: 'Briefing' });
    await screen.findByText('Nothing to report yet');

    const blocks = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent);
    expect(blocks).toEqual([
      'Posture',
      'Needs your review',
      'Risk over time',
      'Where the risky mail came from',
    ]);
  });

  // With nothing scanned, the page must not claim the inbox is in trouble, and
  // must not fall back to bare "0" placeholders.
  it('stays calm and human when there is nothing to report', async () => {
    renderDashboard();

    expect(await screen.findByText('Nothing to report yet')).toBeTruthy();
    expect(screen.getByText(/Nothing has been synced for this time range yet/)).toBeTruthy();
    expect(screen.getByText(/Nothing needs your attention right now/)).toBeTruthy();
    expect(screen.getByText(/No message was flagged on any day in this range/)).toBeTruthy();
    expect(screen.getByText(/No domain sent you anything suspicious in this range/)).toBeTruthy();
  });

  it('states the posture conclusion and folds the key counts into it', async () => {
    api.stats = {
      total: 44,
      counts: {
        safe: 30,
        reviewed_safe: 2,
        needs_review: 5,
        quarantine: 2,
        confirmed_phishing: 1,
        unscanned: 4,
      },
    };

    renderDashboard();

    // 32 safe of 40 scanned = 80% -> the ramp's "a few messages" reading.
    expect(await screen.findByText('A few messages need attention')).toBeTruthy();
    // The gauge is labelled with the value AND the plain-language conclusion.
    expect(
      screen.getByRole('img', { name: 'Safe rate 80 percent. A few messages need attention.' })
    ).toBeTruthy();
    expect(
      screen.getByText(/2 messages look like phishing, and 5 more are worth a second look/)
    ).toBeTruthy();

    // Counts are quiet inline figures, not four separate stat cards.
    expect(screen.getByText('Suspicious')).toBeTruthy();
    expect(screen.getByText('Likely phishing')).toBeTruthy();
    expect(screen.getByText('Confirmed by you')).toBeTruthy();
    expect(screen.getByText('Scanned, of 44 synced')).toBeTruthy();
  });

  it('orders the review queue most urgent first and links each row into the inbox', async () => {
    api.stats = { total: 2, counts: { quarantine: 2 } };
    api.emails = {
      items: [
        {
          id: 'low',
          subject: 'Invoice attached',
          from: 'Billing <billing@example.com>',
          riskBucket: 'quarantine',
          receivedAt: '2026-07-20T10:00:00.000Z',
          latestScan: { score: 64 },
        },
        {
          id: 'high',
          subject: 'Your account will be closed',
          from: 'Security <security@mail-secure-alerts.com>',
          riskBucket: 'quarantine',
          receivedAt: '2026-07-19T10:00:00.000Z',
          latestScan: { score: 91 },
        },
      ],
      pagination: { totalPages: 1 },
    };

    renderDashboard();

    const first = await screen.findByText('Your account will be closed');
    // Each row opens THAT message with the queue's own filter still applied, so
    // the list beside it is the rest of the review queue rather than the whole
    // inbox. The id travels in `?selected=`, which is where the two-pane inbox
    // reads it from — a bare /inbox/:id path is dropped by the redirect.
    const rows = screen
      .getAllByRole('link')
      .filter((el) => el.getAttribute('href')?.startsWith('/inbox?riskBucket=quarantine&selected='));
    expect(rows.map((el) => el.getAttribute('href'))).toEqual([
      '/inbox?riskBucket=quarantine&selected=high',
      '/inbox?riskBucket=quarantine&selected=low',
    ]);
    expect(within(rows[0]).getByText('91')).toBeTruthy();
    expect(rows[0].contains(first)).toBe(true);
  });

  it('links each attacking domain to a filtered inbox search', async () => {
    api.senders = [
      { domain: 'mail-secure-alerts.com', total: 7, needsReview: 3, quarantine: 3, confirmedPhishing: 1 },
    ];

    renderDashboard();

    const link = await screen.findByRole('link', { name: /mail-secure-alerts\.com/ });
    expect(link.getAttribute('href')).toBe('/inbox?q=mail-secure-alerts.com');
    expect(within(link).getByText('7')).toBeTruthy();
  });
});
