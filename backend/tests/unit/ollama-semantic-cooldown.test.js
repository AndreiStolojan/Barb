import test from 'node:test';
import assert from 'node:assert/strict';

import {
    analyzeEmailSemanticsWithOllama,
    resetOllamaSemanticCooldown,
} from '../../src/services/ollama-semantic.service.js';

// A down or hung Ollama used to cost a full timeout on every email of a sync.
// After one failure, the next minute of scans must skip the network entirely.
test('an unreachable Ollama is not retried for every email', async (t) => {
    resetOllamaSemanticCooldown();
    t.after(resetOllamaSemanticCooldown);
    let requests = 0;
    t.mock.method(globalThis, 'fetch', async () => {
        requests += 1;
        throw new TypeError('fetch failed');
    });

    const first = await analyzeEmailSemanticsWithOllama({ analysisInput: {}, enabled: true });
    const requestsForFirstEmail = requests;
    const second = await analyzeEmailSemanticsWithOllama({ analysisInput: {}, enabled: true });

    assert.equal(first.status, 'failed');
    assert.equal(first.error, 'ollama_unreachable');
    assert.ok(requestsForFirstEmail > 0);
    assert.equal(second.status, 'failed');
    assert.equal(second.error, 'ollama_unreachable');
    assert.equal(second.cooldown, true);
    assert.equal(requests, requestsForFirstEmail);
});

test('invalid model output does not pause later scans', async (t) => {
    resetOllamaSemanticCooldown();
    t.after(resetOllamaSemanticCooldown);
    let requests = 0;
    t.mock.method(globalThis, 'fetch', async () => {
        requests += 1;
        return Response.json({ message: { content: 'not json' } });
    });

    await analyzeEmailSemanticsWithOllama({ analysisInput: {}, enabled: true });
    await analyzeEmailSemanticsWithOllama({ analysisInput: {}, enabled: true });

    assert.equal(requests, 2);
});
