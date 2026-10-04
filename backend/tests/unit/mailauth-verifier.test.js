// ─────────────────────────────────────────────────────────────────────────────
// Offline protocol fixtures and worker resource-boundary tests for DKIM/ARC.
// ─────────────────────────────────────────────────────────────────────────────

import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { collectEmailAuthSignals } from '../../src/detection/providers/email-auth.provider.js';
import { verifyWithMailauth } from '../../src/services/email-auth/mailauth-verifier.core.js';
import {
    createVerificationLimiter,
    createDkimWorkerPool,
    verifyDkimAndArc,
} from '../../src/services/email-auth/dkim-verifier.service.js';

const fixture = (name) => readFileSync(
    new URL(`../fixtures/email-auth/${name}`, import.meta.url)
);

const fixtureJson = (name) => JSON.parse(fixture(name).toString('utf8'));

const createFixtureResolver = (records) => async (name, type) => {
    const value = records[name.toLowerCase().trim()]?.[type];

    if (value) {
        return value;
    }

    const error = new Error('Fixture DNS record not found');
    error.code = 'ENOTFOUND';
    throw error;
};

test('locally verifies all signatures on the known-good DKIM fixture', async () => {
    const result = await verifyWithMailauth(fixture('dkim-good.eml'), {
        resolver: createFixtureResolver(fixtureJson('dkim-dns.json')),
        minBitLength: 1024,
    });

    assert.equal(result.dkim.result, 'pass');
    assert.equal(result.dkim.domain, 'football.example.com');
    assert.equal(result.dkim.aligned, true);
    assert.deepEqual(
        result.dkim.signatures.map(({ result: signatureResult, selector }) => ({
            result: signatureResult,
            selector,
        })),
        [
            { result: 'pass', selector: 'brisbane' },
            { result: 'pass', selector: 'test' },
        ]
    );
    assert.equal(result.arc.result, 'none');

    assert.deepEqual(Object.keys(result.dkim).sort(), [
        'aligned',
        'domain',
        'result',
        'selector',
        'signatures',
        'source',
    ]);
    for (const signature of result.dkim.signatures) {
        assert.deepEqual(Object.keys(signature).sort(), [
            'aligned',
            'domain',
            'result',
            'selector',
        ]);
    }
});

test('maps a cryptographically tampered DKIM body to fail', async () => {
    const result = await verifyWithMailauth(fixture('dkim-tampered.eml'), {
        resolver: createFixtureResolver(fixtureJson('dkim-dns.json')),
        minBitLength: 1024,
    });

    assert.equal(result.dkim.result, 'fail');
    assert.deepEqual(
        result.dkim.signatures.map(({ result: signatureResult }) => signatureResult),
        ['fail', 'fail']
    );
});

test('reports none for an unsigned message without making DNS requests', async () => {
    let dnsCalls = 0;
    const result = await verifyWithMailauth(fixture('dkim-unsigned.eml'), {
        resolver: async () => {
            dnsCalls += 1;
            throw new Error('Unexpected DNS request');
        },
    });

    assert.equal(result.dkim.result, 'none');
    assert.equal(result.dkim.domain, null);
    assert.equal(result.arc.result, 'none');
    assert.equal(dnsCalls, 0);
});

test('validates a complete two-hop ARC chain and rejects its tampered body', async () => {
    const rawMessage = fixture('arc-two-hop-pass.eml');
    const resolver = createFixtureResolver(fixtureJson('arc-dns.json'));

    const passing = await verifyWithMailauth(rawMessage, {
        resolver,
        minBitLength: 1024,
    });
    assert.deepEqual(passing.arc, { result: 'pass', chainLength: 2 });

    const tamperedMessage = Buffer.from(
        rawMessage.toString('utf8').replace('Hey gang,', 'Tampered,')
    );
    const failing = await verifyWithMailauth(tamperedMessage, {
        resolver,
        minBitLength: 1024,
    });
    assert.deepEqual(failing.arc, { result: 'fail', chainLength: 2 });
});

test('a cryptographically verified ARC fixture suppresses only transport failures', async () => {
    const verified = await verifyWithMailauth(fixture('arc-two-hop-pass.eml'), {
        resolver: createFixtureResolver(fixtureJson('arc-dns.json')),
        minBitLength: 1024,
    });
    const signals = collectEmailAuthSignals({
        authResults: {
            status: 'ok',
            spf: { result: 'fail' },
            dkim: { result: 'fail' },
            dmarc: { result: 'fail', policy: 'reject' },
            arc: verified.arc,
        },
        brandContext: { brandState: 'unknown' },
    });

    assert.deepEqual(signals.map(({ key }) => key), ['dmarc_fail_policy_reject']);
});

test('the production worker boundary handles an unsigned message', async () => {
    const result = await verifyDkimAndArc(fixture('dkim-unsigned.eml'), {
        // This is the one case that spawns a real worker thread and runs real
        // mailauth verification, so it pays Node's worker startup cost. Under a
        // full-suite run on a loaded machine that overran a 2s budget — observed
        // at 2049ms — and the test failed intermittently while passing in
        // isolation. The budget is not what this test is checking: the
        // assertions below are about an unsigned message producing `none`
        // rather than an error. Timeout behaviour has its own tests at :164
        // and :201, which use short budgets deliberately.
        timeoutMs: 30_000,
        limiter: createVerificationLimiter({ concurrency: 1 }),
    });

    assert.equal(result.status, 'ok');
    assert.equal(result.failureReason, null);
    assert.equal(result.dkim.result, 'none');
    assert.equal(result.arc.result, 'none');
});

test('terminates a hung verification worker at the hard deadline', async () => {
    let terminated = false;

    class HangingWorker extends EventEmitter {
        postMessage() {}

        terminate() {
            terminated = true;
            return Promise.resolve(1);
        }
    }

    const startedAt = Date.now();
    const result = await verifyDkimAndArc(Buffer.from('message'), {
        timeoutMs: 25,
        limiter: createVerificationLimiter({ concurrency: 1 }),
        pool: createDkimWorkerPool({ workerFactory: () => new HangingWorker() }),
    });

    assert.equal(result.status, 'unavailable');
    assert.equal(result.failureReason, 'mailauth_timeout');
    assert.equal(terminated, true);
    assert.ok(Date.now() - startedAt < 1_000);
});

test('fails open when mailauth reports a temporary DNS verification error', async () => {
    class ReportingWorker extends EventEmitter {
        postMessage({ id }) {
            queueMicrotask(() => this.emit('message', {
                id,
                ok: true,
                result: {
                    dkim: {
                        result: 'temperror',
                        domain: 'example.test',
                        selector: 'selector',
                        aligned: false,
                        source: 'local_verify',
                        signatures: [],
                    },
                    arc: { result: 'none', chainLength: 0 },
                },
            }));
        }

        terminate() {
            return Promise.resolve(1);
        }
    }

    const result = await verifyDkimAndArc(Buffer.from('message'), {
        timeoutMs: 100,
        limiter: createVerificationLimiter({ concurrency: 1 }),
        pool: createDkimWorkerPool({ workerFactory: () => new ReportingWorker() }),
    });

    assert.equal(result.status, 'unavailable');
    assert.equal(result.failureReason, 'mailauth_dns_failure');
    assert.equal(result.dkim.result, 'temperror');
});

test('fails open when the verified signature set exceeds the persisted bound', async () => {
    class ReportingWorker extends EventEmitter {
        postMessage({ id }) {
            queueMicrotask(() =>
                this.emit('message', {
                    id,
                    ok: true,
                    result: {
                        dkim: {
                            result: 'pass',
                            domain: 'example.test',
                            selector: 'selector-33',
                            aligned: true,
                            source: 'local_verify',
                            signatures: [],
                        },
                        arc: { result: 'none', chainLength: 0 },
                        signatureLimitExceeded: true,
                    },
                })
            );
        }

        terminate() {
            return Promise.resolve(1);
        }
    }

    const result = await verifyDkimAndArc(Buffer.from('message'), {
        timeoutMs: 100,
        limiter: createVerificationLimiter({ concurrency: 1 }),
        pool: createDkimWorkerPool({ workerFactory: () => new ReportingWorker() }),
    });

    assert.equal(result.status, 'unavailable');
    assert.equal(result.failureReason, 'mailauth_signature_limit');
    assert.equal(result.dkim.result, 'none');
    assert.deepEqual(result.dkim.signatures, []);
});

test('rejects missing and oversized raw messages before starting a worker', async () => {
    let workerStarts = 0;
    const workerFactory = () => {
        workerStarts += 1;
        throw new Error('Worker must not start');
    };

    const pool = createDkimWorkerPool({ workerFactory });
    const missing = await verifyDkimAndArc(null, { pool });
    const oversized = await verifyDkimAndArc(Buffer.alloc(5), {
        maxRawBytes: 4,
        pool,
    });

    assert.equal(missing.failureReason, 'raw_message_missing');
    assert.equal(oversized.failureReason, 'raw_message_too_large');
    assert.equal(workerStarts, 0);
});

test('bounds the worker queue instead of allowing unbounded verification jobs', async () => {
    const limiter = createVerificationLimiter({ concurrency: 1, maxQueue: 1 });
    const releaseFirst = await limiter.acquire(1_000);
    const queued = limiter.acquire(1_000);

    await assert.rejects(
        limiter.acquire(1_000),
        /verification_queue_full/
    );

    releaseFirst();
    const releaseSecond = await queued;
    releaseSecond();
});

// Answers every request with an empty, passing verification. `hang` makes it
// ignore requests so the caller's deadline fires.
class PooledWorker extends EventEmitter {
    constructor(log) {
        super();
        this.log = log;
        this.hang = false;
        log.started += 1;
    }

    postMessage({ id }) {
        if (this.hang) return;
        queueMicrotask(() => this.emit('message', {
            id,
            ok: true,
            result: {
                dkim: { result: 'none', signatures: [] },
                arc: { result: 'none', chainLength: 0 },
            },
        }));
    }

    terminate() {
        this.log.terminated += 1;
        queueMicrotask(() => this.emit('exit', 1));
        return Promise.resolve(1);
    }
}

test('reuses one verification worker across sequential messages', async () => {
    const log = { started: 0, terminated: 0 };
    const pool = createDkimWorkerPool({ workerFactory: () => new PooledWorker(log) });

    for (let index = 0; index < 3; index += 1) {
        const result = await verifyDkimAndArc(Buffer.from('message'), { pool });
        assert.equal(result.status, 'ok');
    }

    assert.equal(log.started, 1);
    assert.equal(log.terminated, 0);
});

test('replaces a worker that timed out and retires idle workers', async () => {
    const log = { started: 0, terminated: 0 };
    let next = null;
    const pool = createDkimWorkerPool({
        idleMs: 20,
        workerFactory: () => {
            next = new PooledWorker(log);
            return next;
        },
    });

    await verifyDkimAndArc(Buffer.from('message'), { pool });
    next.hang = true;
    const timedOut = await verifyDkimAndArc(Buffer.from('message'), { pool, timeoutMs: 100 });
    assert.equal(timedOut.failureReason, 'mailauth_timeout');
    assert.equal(log.terminated, 1);

    const recovered = await verifyDkimAndArc(Buffer.from('message'), { pool });
    assert.equal(recovered.status, 'ok');
    assert.equal(log.started, 2);

    await new Promise((resolve) => setTimeout(resolve, 60));
    assert.equal(log.terminated, 2);
});
