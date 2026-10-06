import test from 'node:test';
import assert from 'node:assert/strict';

import {
    contactMessageTemplate,
    dailyDigestTemplate,
    phishingAlertTemplate,
} from '../../extras/notifications/email.template.js';

/*
 * The alert and digest emails quote attacker-controlled text (sender, subject)
 * and explain each flagged message with its strongest rule. These tests pin
 * the escaping, the evidence shown, and the deep link into the inbox.
 */

const flaggedEmail = (overrides = {}) => ({
    _id: '665f1c2e9b1e8a0012345678',
    subject: 'Your account is <b>limited</b>',
    from: 'PayPal <service@paypa1-resolution.com>',
    score: 91.4,
    triggeredRules: [
        { rule: 'reply_to_mismatch', points: 18 },
        { rule: 'email_auth:spf_hardfail', points: 30 },
        { rule: 'sender_allowlisted', points: -40 },
    ],
    ...overrides,
});

test('phishing alert escapes sender and subject', () => {
    const { html, subject } = phishingAlertTemplate({
        emails: [flaggedEmail({ from: '"<script>x</script>" <evil@example.com>' })],
    });

    assert.equal(subject, '1 message looks like phishing');
    assert.ok(!html.includes('<script>'), 'sender name must be escaped');
    assert.ok(!html.includes('<b>limited</b>'), 'subject must be escaped');
    assert.match(html, /Your account is &lt;b&gt;limited&lt;\/b&gt;/);
});

test('phishing alert lists the strongest reasons first and links to the message', () => {
    const { html } = phishingAlertTemplate({ emails: [flaggedEmail()] });

    const spf = html.indexOf('not authorised to send');
    const replyTo = html.indexOf('Reply address differs');
    assert.ok(spf > -1 && replyTo > spf, 'the 30-point rule comes before the 18-point rule');
    assert.ok(!html.includes('A suspicious pattern was detected'), 'rules that lowered the score are not reasons');
    assert.match(html, /\/inbox\?selected=665f1c2e9b1e8a0012345678/);
    assert.match(html, />91<\/span>/, 'score is rounded');
});

test('daily digest shows one reason per flagged message and links by email id', () => {
    const { html, subject } = dailyDigestTemplate({
        userName: 'Andrei',
        summary: {
            counts: { syncedEmails: 10, scannedEmails: 10, safe: 8, suspicious: 1, likelyPhishing: 1 },
            riskyEmails: [
                flaggedEmail({ _id: undefined, emailId: 'abc123', verdict: 'likely_phishing' }),
                flaggedEmail({ _id: undefined, emailId: 'def456', verdict: 'suspicious', triggeredRules: [] }),
            ],
        },
    });

    assert.equal(subject, '1 message looks like phishing');
    assert.match(html, /1 more is worth a second look\./);
    assert.match(html, /\/inbox\?selected=abc123/);
    assert.match(html, /\/inbox\?selected=def456/);
    assert.ok(html.includes('not authorised to send'), 'top reason is shown');
    assert.ok(!html.includes('Reply address differs'), 'digest rows show only the top reason');
});

test('daily digest with nothing flagged says so', () => {
    const { html, subject } = dailyDigestTemplate({
        userName: 'Andrei',
        summary: { counts: { syncedEmails: 31, scannedEmails: 31, safe: 31, suspicious: 0, likelyPhishing: 0 }, riskyEmails: [] },
    });

    assert.equal(subject, 'Nothing needs your attention today');
    assert.match(html, /All 31 messages look safe\./);
    assert.ok(!html.includes('Review them'));
});

test('contact message escapes the user-supplied fields', () => {
    const html = contactMessageTemplate({
        userName: 'Ana <img src=x>',
        userEmail: 'ana@example.com',
        subject: 'Help & <b>',
        message: 'line one\n<a href="javascript:alert(1)">x</a>',
    });

    assert.ok(!html.includes('<img src=x>'));
    assert.ok(!html.includes('<a href="javascript'));
    assert.match(html, /Help &amp; &lt;b&gt;/);
    assert.match(html, /line one<br>/);
});
