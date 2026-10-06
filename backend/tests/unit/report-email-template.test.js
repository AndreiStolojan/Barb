import test from 'node:test';
import assert from 'node:assert/strict';

import { monthlyDigestTemplate } from '../../extras/notifications/email.template.js';

/*
 * Regression tests for the report email's safe-rate / threat breakdown.
 *
 * The bug: the monthly digest email computed its "% safe" and threat breakdown
 * from the RAW scan verdicts (counts.safe / counts.suspicious / ...) instead of
 * the EFFECTIVE verdicts that apply the user's manual "mark safe" / "mark
 * phishing" overrides. The report service already returns both — the dashboard
 * uses the effective ones, the email used the raw ones. So after a user marked
 * suspicious / likely-phishing emails as safe, the dashboard % moved but the
 * emailed % did not: they disagreed for the same period.
 *
 * These tests render the template directly (pure function, no DB) and assert the
 * email reflects the effective (post-review) numbers.
 */

// A scanned set of 4 emails. Raw scan said 1 safe + 2 suspicious + 1 likely
// phishing. The user then reviewed all 3 risky ones and marked them safe, so the
// EFFECTIVE split is 4 safe / 0 threats.
const summaryWithUserOverrides = () => ({
    period: {
        from: '2026-06-01T00:00:00.000Z',
        to: '2026-06-08T00:00:00.000Z',
        label: 'Last 7 days',
    },
    counts: {
        syncedEmails: 4,
        scannedEmails: 4,
        // raw scan verdicts (what the email WRONGLY used)
        safe: 1,
        suspicious: 2,
        likelyPhishing: 1,
        markedPhishing: 0,
        // effective verdicts after the user marked the 3 risky emails safe
        effectiveSafe: 4,
        effectiveSuspicious: 0,
        effectiveLikelyPhishing: 0,
        effectiveMarkedPhishing: 0,
    },
    topTriggeredRules: [],
    ai: { evaluated: 4, failed: 0, disabled: 0 },
    generatedAt: '2026-06-08T09:00:00.000Z',
});

// The count shown in the legend row for `label`.
const legendCount = (html, label) => {
    const row = html.slice(html.indexOf(`>${label}</p>`));
    return row.match(/font-weight:600;">([\d,]+)<\/p>/)?.[1];
};

test('report email safe-rate reflects user "mark safe" overrides, not raw scan verdicts', () => {
    const { html, subject } = monthlyDigestTemplate({
        summary: summaryWithUserOverrides(),
        userName: 'Andrei',
    });

    // After marking every risky email safe, the period is 100% safe — matching
    // the dashboard. The buggy version showed 25% (1 raw-safe of 4 scanned).
    assert.match(html, />100%<\/span> of your mail was safe/, 'lead should show 100% safe after overrides');
    assert.match(html, /100% safe, 0 flagged/, 'preheader should show 100% safe');
    assert.ok(!html.includes('>25%<'), 'must not show the raw-scan 25% rate');

    // No outstanding threats once everything risky is marked safe.
    assert.match(html, /Nothing was flagged\./, 'threat count must drop to 0 after overrides');
    assert.ok(!subject.includes('undefined'), 'subject renders cleanly');
});

test('report email verdict breakdown uses effective counts', () => {
    const { html } = monthlyDigestTemplate({
        summary: summaryWithUserOverrides(),
        userName: 'Andrei',
    });

    assert.equal(legendCount(html, 'Safe'), '4', 'Safe row counts the 4 effective-safe emails');
    assert.equal(legendCount(html, 'Suspicious'), '0', 'Suspicious row is 0 after overrides');
    assert.equal(legendCount(html, 'Likely phishing'), '0', 'Likely phishing row is 0 after overrides');
});

test('report email is unchanged when there are no user overrides', () => {
    // Sanity: when effective == raw (nobody reviewed anything), the numbers the
    // user expects are still correct — 3 safe of 4 scanned = 75%.
    const summary = {
        period: { from: '2026-06-01T00:00:00.000Z', to: '2026-06-08T00:00:00.000Z', label: 'Last 7 days' },
        counts: {
            syncedEmails: 4,
            scannedEmails: 4,
            safe: 3,
            suspicious: 1,
            likelyPhishing: 0,
            markedPhishing: 0,
            effectiveSafe: 3,
            effectiveSuspicious: 1,
            effectiveLikelyPhishing: 0,
            effectiveMarkedPhishing: 0,
        },
        topTriggeredRules: [],
        ai: { evaluated: 4, failed: 0, disabled: 0 },
        generatedAt: '2026-06-08T09:00:00.000Z',
    };

    const { html } = monthlyDigestTemplate({ summary, userName: 'Andrei' });
    assert.match(html, />75%<\/span> of your mail was safe/, 'lead should show 75% safe');
    assert.match(html, /1 message was flagged\./, 'one outstanding suspicious email');
    assert.equal(legendCount(html, 'Suspicious'), '1');
});

test('report email says when the AI layer did not run', () => {
    const summary = summaryWithUserOverrides();
    summary.ai = { evaluated: 0, failed: 0, disabled: 4 };

    const { html } = monthlyDigestTemplate({ summary });
    assert.match(html, /AI analysis is off\. The rule score stands alone\./);
});
