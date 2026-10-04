// ─────────────────────────────────────────────────────────────────────────────
// detection-registry.test.js — contractul și izolarea providerilor de detecție.
//
// Providerii sunt executați în ordine, iar erorile lor nu întrerup scanarea.
// Detalii: docs/detection-engine.md.
// ─────────────────────────────────────────────────────────────────────────────

import assert from 'node:assert/strict';
import test from 'node:test';

import {
    runProviders,
    validateProviderRegistry,
} from '../../src/detection/registry.js';
import { runDetection } from '../../src/detection/index.js';
import * as aiSemanticProvider from '../../src/detection/providers/ai-semantic.provider.js';

const provider = ({
    id,
    kind = 'rule',
    optional = true,
    analyze,
}) => ({
    meta: {
        id,
        version: 1,
        kind,
        optional,
    },
    analyze,
});

const noMetrics = () => {};

// One 18-point rule: enough evidence that AI can still change the verdict.
const replyToMismatch = provider({
    id: 'reply-to-test',
    analyze: async () => ({ signals: [{ key: 'reply_to_mismatch', reason: 'Reply-To differs.' }] }),
});

test('registry awaits sync and async providers in declared order', async () => {
    const events = [];
    const providers = [
        provider({
            id: 'sync-first',
            analyze: () => {
                events.push('sync');
                return { signals: [{ key: 'reply_to_mismatch' }] };
            },
        }),
        provider({
            id: 'async-second',
            analyze: async () => {
                await Promise.resolve();
                events.push('async');
                return { signals: [{ key: 'too_many_links_medium' }] };
            },
        }),
    ];

    const result = await runProviders({}, {
        providers,
        recordOutcome: noMetrics,
    });

    assert.deepEqual(events, ['sync', 'async']);
    assert.deepEqual(
        result.signals.map(({ providerId, sequence }) => ({ providerId, sequence })),
        [
            { providerId: 'sync-first', sequence: 0 },
            { providerId: 'async-second', sequence: 1 },
        ]
    );
    assert.deepEqual(
        result.providerMeta.map(({ provider, status }) => ({ provider, status })),
        [
            { provider: 'sync-first', status: 'success' },
            { provider: 'async-second', status: 'success' },
        ]
    );
});

test('sync throws and async rejections are isolated while later providers complete', async () => {
    const outcomes = [];
    const providers = [
        provider({
            id: 'sync-error',
            analyze: () => {
                throw new Error('sync exploded');
            },
        }),
        provider({
            id: 'async-error',
            analyze: async () => {
                throw new Error('async exploded');
            },
        }),
        provider({
            id: 'survivor',
            analyze: () => ({
                signals: [{ key: 'reply_to_mismatch' }],
            }),
        }),
    ];

    const result = await runProviders({}, {
        providers,
        recordOutcome: (outcome) => outcomes.push(outcome),
    });

    assert.deepEqual(result.signals.map(({ providerId }) => providerId), ['survivor']);
    assert.deepEqual(outcomes, [
        { provider: 'sync-error', result: 'error' },
        { provider: 'async-error', result: 'error' },
        { provider: 'survivor', result: 'success' },
    ]);
    assert.deepEqual(
        result.providerMeta.map(({ provider: id, status, message }) => ({
            id,
            status,
            message,
        })),
        [
            { id: 'sync-error', status: 'error', message: 'sync exploded' },
            { id: 'async-error', status: 'error', message: 'async exploded' },
            { id: 'survivor', status: 'success', message: undefined },
        ]
    );
});

test('malformed results and provider-assigned points become isolated errors', async () => {
    const providers = [
        provider({
            id: 'missing-signals',
            analyze: () => ({}),
        }),
        provider({
            id: 'invalid-signal',
            analyze: () => ({ signals: [{ key: '' }] }),
        }),
        provider({
            id: 'assigned-points',
            analyze: () => ({
                signals: [{ key: 'reply_to_mismatch', points: 999 }],
            }),
        }),
        provider({
            id: 'valid',
            analyze: () => ({
                signals: [{ key: 'reply_to_mismatch' }],
            }),
        }),
    ];

    const result = await runProviders({}, {
        providers,
        recordOutcome: noMetrics,
    });

    assert.deepEqual(result.signals.map(({ providerId }) => providerId), ['valid']);
    assert.deepEqual(
        result.providerMeta.map(({ status }) => status),
        ['error', 'error', 'error', 'success']
    );
    assert.match(result.providerMeta[0].message, /invalid result/);
    assert.match(result.providerMeta[1].message, /invalid signal/);
    assert.match(result.providerMeta[2].message, /assigned points directly/);
});

test('wrong-kind weight keys are isolated before scoring', async () => {
    const providers = [
        provider({
            id: 'rule-emits-ai',
            kind: 'rule',
            analyze: () => ({
                signals: [{ key: 'urgency_high' }],
            }),
        }),
        provider({
            id: 'ai-emits-rule',
            kind: 'ai',
            analyze: () => ({
                signals: [{ key: 'reply_to_mismatch' }],
            }),
        }),
        provider({
            id: 'valid-after-mismatches',
            analyze: () => ({
                signals: [{ key: 'reply_to_mismatch' }],
            }),
        }),
    ];

    const result = await runProviders({}, {
        providers,
        recordOutcome: noMetrics,
    });

    assert.deepEqual(
        result.providerMeta.map(({ status }) => status),
        ['error', 'error', 'success']
    );
    assert.deepEqual(
        result.signals.map(({ providerId }) => providerId),
        ['valid-after-mismatches']
    );
});

test('a disabled provider records skipped and contributes no signals', async () => {
    const outcomes = [];
    const skipped = provider({
        id: 'disabled',
        analyze: () => ({
            status: 'skipped',
            signals: [],
            meta: {
                disabledReason: 'feature_disabled',
            },
        }),
    });

    const result = await runProviders({}, {
        providers: [skipped],
        recordOutcome: (outcome) => outcomes.push(outcome),
    });

    assert.deepEqual(result.signals, []);
    assert.deepEqual(outcomes, [{ provider: 'disabled', result: 'skipped' }]);
    assert.deepEqual(result.providerMeta, [
        {
            provider: 'disabled',
            version: 1,
            kind: 'rule',
            status: 'skipped',
            meta: {
                disabledReason: 'feature_disabled',
            },
        },
    ]);
});

test('operational provider failure records error without throwing', async () => {
    const outcomes = [];
    const operationalFailure = provider({
        id: 'ai-operational-failure',
        kind: 'ai',
        analyze: () => ({
            status: 'error',
            signals: [],
            meta: {
                semanticStatus: 'failed',
            },
        }),
    });

    const result = await runProviders({}, {
        providers: [operationalFailure],
        recordOutcome: (outcome) => outcomes.push(outcome),
    });

    assert.deepEqual(outcomes, [
        { provider: 'ai-operational-failure', result: 'error' },
    ]);
    assert.equal(result.providerMeta[0].status, 'error');
    assert.equal(result.providerMeta[0].meta.semanticStatus, 'failed');
});

test('AI analyzer failed status is reported as a provider error and remains available', async () => {
    const outcomes = [];
    const aiSignals = {
        status: 'failed',
        provider: 'ollama',
        fallbackReason: 'ollama_unreachable',
    };
    const result = await runProviders(
        {
            userSettings: { aiEnabled: true },
            aiInput: {},
            scanContext: {},
            semanticAnalyzer: async () => aiSignals,
        },
        {
            providers: [replyToMismatch, aiSemanticProvider],
            recordOutcome: (outcome) => outcomes.push(outcome),
        }
    );

    assert.deepEqual(outcomes, [
        { provider: 'reply-to-test', result: 'success' },
        { provider: 'ai-semantic', result: 'error' },
    ]);
    assert.equal(result.providerMeta[1].status, 'error');
    assert.equal(
        result.providerResults.get('ai-semantic').meta.aiSignals,
        aiSignals
    );
});

test('runDetection synthesizes failed AI metadata when the AI provider throws', async () => {
    const throwingAiProvider = provider({
        id: 'ai-semantic',
        kind: 'ai',
        analyze: async () => {
            throw new Error('semantic analyzer crashed');
        },
    });

    const result = await runDetection(
        { scanContext: {} },
        {
            providers: [throwingAiProvider],
            recordOutcome: noMetrics,
        }
    );

    assert.equal(result.aiSignals.status, 'failed');
    assert.equal(result.aiSignals.fallbackReason, 'detection_provider_error');
    assert.equal(result.providerMeta[0].status, 'error');
});

test('runDetection reports unavailable AI when a custom registry has no AI provider', async () => {
    const ruleOnlyProvider = provider({
        id: 'rule-only',
        analyze: async () => ({ signals: [] }),
    });

    const result = await runDetection(
        { scanContext: {} },
        {
            providers: [ruleOnlyProvider],
            recordOutcome: noMetrics,
        }
    );

    assert.equal(result.aiSignals.status, 'failed');
    assert.equal(result.aiSignals.fallbackReason, 'ai_signal_unavailable');
});

test('custom registries can replace the production metrics recorder explicitly', async () => {
    const newProvider = provider({
        id: 'new-provider',
        analyze: () => ({ signals: [] }),
    });

    const result = await runProviders({}, {
        providers: [newProvider],
        recordOutcome: noMetrics,
    });

    assert.equal(result.providerMeta[0].status, 'success');
});

test('registry rejects duplicate ids and malformed provider contracts up front', () => {
    const first = provider({
        id: 'duplicate',
        analyze: () => ({ signals: [] }),
    });
    const second = provider({
        id: 'duplicate',
        analyze: () => ({ signals: [] }),
    });

    assert.throws(
        () => validateProviderRegistry([first, second]),
        /Duplicate detection provider id: duplicate/
    );
    assert.throws(
        () => validateProviderRegistry([{ meta: { id: 'broken' } }]),
        /Invalid detection provider contract/
    );
});

// Rule signals that fix the verdict on their own make a model call pointless:
// AI is capped below `suspicious` without rule evidence, and cannot raise a
// `likely_phishing` verdict any further.
test('AI runs only when its points could change the verdict', async () => {
    const blocklisted = provider({
        id: 'blocklist-test',
        analyze: async () => ({ signals: [{ key: 'user_blocklist_match', reason: 'Blocked.' }] }),
    });
    const runWith = async (ruleProviders) => {
        let calls = 0;
        const result = await runDetection(
            {
                userSettings: { aiEnabled: true },
                aiInput: {},
                scanContext: {},
                semanticAnalyzer: async () => {
                    calls += 1;
                    return { status: 'evaluated', urgencyLevel: 'high' };
                },
            },
            { providers: [...ruleProviders, aiSemanticProvider], recordOutcome: noMetrics }
        );
        return { calls, result };
    };

    const noEvidence = await runWith([]);
    assert.equal(noEvidence.calls, 0);
    assert.equal(noEvidence.result.aiSignals.status, 'skipped');
    assert.equal(noEvidence.result.verdict, 'safe');

    const decided = await runWith([blocklisted]);
    assert.equal(decided.calls, 0);
    assert.equal(decided.result.verdict, 'likely_phishing');

    const borderline = await runWith([replyToMismatch]);
    assert.equal(borderline.calls, 1);
    assert.equal(borderline.result.aiSignals.status, 'evaluated');
    assert.ok(borderline.result.aiScore > 0);
});
