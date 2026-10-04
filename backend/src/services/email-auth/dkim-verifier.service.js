// ────────────────────────────────────────────────────────────────────────────────
// Hard-timeout and resource boundary for local DKIM/ARC verification.
// ────────────────────────────────────────────────────────────────────────────────

import { Worker } from 'node:worker_threads';

const DEFAULT_TIMEOUT_MS = 5_000;
const DEFAULT_MAX_RAW_BYTES = 32 * 1024 * 1024;
const DEFAULT_MAX_CONCURRENCY = 2;
const DEFAULT_MAX_QUEUE = 32;
const DEFAULT_MIN_BIT_LENGTH = 1024;
const DEFAULT_WORKER_IDLE_MS = 60_000;
const WORKER_URL = new URL('./dkim-verifier.worker.js', import.meta.url);

const readPositiveInteger = (value, fallback, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) => {
    const parsed = Number.parseInt(value, 10);

    if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
        return fallback;
    }

    return parsed;
};

const configuredTimeoutMs = readPositiveInteger(
    process.env.EMAIL_AUTH_VERIFY_TIMEOUT_MS,
    DEFAULT_TIMEOUT_MS,
    { min: 100, max: 30_000 }
);
const configuredMaxRawBytes = readPositiveInteger(
    process.env.EMAIL_AUTH_MAX_RAW_BYTES,
    DEFAULT_MAX_RAW_BYTES,
    { min: 1_024, max: 64 * 1024 * 1024 }
);
const configuredMaxConcurrency = readPositiveInteger(
    process.env.EMAIL_AUTH_MAX_CONCURRENCY,
    DEFAULT_MAX_CONCURRENCY,
    { min: 1, max: 8 }
);

export const createVerificationLimiter = ({
    concurrency = configuredMaxConcurrency,
    maxQueue = DEFAULT_MAX_QUEUE,
} = {}) => {
    let active = 0;
    const queue = [];

    const releaseNext = () => {
        const next = queue.shift();

        if (next) {
            clearTimeout(next.timeoutId);
            next.resolve(releaseNext);
            return;
        }

        active = Math.max(0, active - 1);
    };

    return {
        acquire(timeoutMs) {
            if (active < concurrency) {
                active += 1;
                return Promise.resolve(releaseNext);
            }

            if (queue.length >= maxQueue) {
                return Promise.reject(new Error('verification_queue_full'));
            }

            return new Promise((resolve, reject) => {
                const entry = { resolve, timeoutId: null };
                entry.timeoutId = setTimeout(() => {
                    const index = queue.indexOf(entry);
                    if (index >= 0) {
                        queue.splice(index, 1);
                    }
                    reject(new Error('verification_queue_timeout'));
                }, timeoutMs);
                queue.push(entry);
            });
        },
    };
};

const defaultLimiter = createVerificationLimiter();

const unavailableResult = (failureReason) => ({
    status: 'unavailable',
    failureReason,
    dkim: {
        result: 'none',
        domain: null,
        selector: null,
        aligned: false,
        source: 'local_verify',
        signatures: [],
    },
    arc: {
        result: 'none',
        chainLength: 0,
    },
});

const createDefaultWorker = () => new Worker(WORKER_URL, { type: 'module' });

const terminateWorker = (worker) => {
    try {
        Promise.resolve(worker.terminate()).catch(() => {});
    } catch {
        // A worker that already exited needs no further cleanup.
    }
};

// Reuses verification workers instead of starting one per message. Starting a
// worker loads mailauth's module graph: ~0.4 s of CPU on the Pi, against
// ~0.5 ms for the verification itself. Each worker handles one message at a
// time (the limiter bounds how many exist), is discarded after a timeout or
// crash, and exits after `idleMs` without work so an idle server holds none.
export const createDkimWorkerPool = ({
    workerFactory = createDefaultWorker,
    idleMs = DEFAULT_WORKER_IDLE_MS,
} = {}) => {
    const idle = [];
    let nextId = 0;

    const retire = (entry) => {
        const index = idle.indexOf(entry);
        if (index >= 0) idle.splice(index, 1);
        clearTimeout(entry.idleTimer);
        terminateWorker(entry.worker);
    };

    const release = (entry) => {
        idle.push(entry);
        entry.idleTimer = setTimeout(() => retire(entry), idleMs);
        entry.idleTimer.unref?.();
    };

    const acquire = () => {
        const entry = idle.pop();
        if (entry) {
            clearTimeout(entry.idleTimer);
            return entry;
        }

        const created = { worker: workerFactory(), idleTimer: null };
        // Never keep the process alive just for an idle verifier, and forget a
        // worker that dies while idle so it is not handed out again.
        created.worker.unref?.();
        // An idle worker's crash has no request to fail; `exit` follows it.
        created.worker.on('error', () => {});
        created.worker.once('exit', () => {
            const index = idle.indexOf(created);
            if (index >= 0) idle.splice(index, 1);
            clearTimeout(created.idleTimer);
        });
        return created;
    };

    const run = ({ rawMessage, timeoutMs, minBitLength }) => new Promise((resolve) => {
        let entry;

        try {
            entry = acquire();
        } catch {
            resolve(unavailableResult('mailauth_worker_failed'));
            return;
        }

        const { worker } = entry;
        const id = ++nextId;
        let settled = false;

        const onMessage = (message) => {
            if (message?.id !== id) return;
            settle(toVerificationResult(message), { reusable: true });
        };
        const onError = () => settle(unavailableResult('mailauth_worker_failed'));
        const onExit = (code) => settle(unavailableResult(
            code === 0 ? 'mailauth_worker_exited' : 'mailauth_worker_failed'
        ));

        function settle(result, { reusable = false } = {}) {
            if (settled) return;
            settled = true;
            clearTimeout(timeoutId);
            worker.off('message', onMessage);
            worker.off('error', onError);
            worker.off('exit', onExit);
            if (reusable) release(entry);
            else retire(entry);
            resolve(result);
        }

        const timeoutId = setTimeout(() => {
            settle(unavailableResult('mailauth_timeout'));
        }, timeoutMs);

        worker.on('message', onMessage);
        worker.on('error', onError);
        worker.on('exit', onExit);

        try {
            // Copy into an exact-sized transferable buffer. Buffer instances may
            // use a shared pool whose backing ArrayBuffer cannot safely be
            // transferred.
            const transferableMessage = Uint8Array.from(rawMessage).buffer;
            worker.postMessage(
                { id, rawMessage: transferableMessage, minBitLength },
                [transferableMessage]
            );
        } catch {
            settle(unavailableResult('mailauth_worker_failed'));
        }
    });

    return { run };
};

const toVerificationResult = (message) => {
    if (!message?.ok || !message.result?.dkim || !message.result?.arc) {
        return unavailableResult('mailauth_verification_failed');
    }
    if (message.result.signatureLimitExceeded) {
        return unavailableResult('mailauth_signature_limit');
    }

    const hasTemporaryDnsFailure =
        message.result.dkim.result === 'temperror' ||
        message.result.dkim.signatures.some(
            (signature) => signature.result === 'temperror'
        );

    return {
        status: hasTemporaryDnsFailure ? 'unavailable' : 'ok',
        failureReason: hasTemporaryDnsFailure ? 'mailauth_dns_failure' : null,
        ...message.result,
    };
};

const defaultPool = createDkimWorkerPool();

export const verifyDkimAndArc = async (rawMessage, {
    timeoutMs = configuredTimeoutMs,
    maxRawBytes = configuredMaxRawBytes,
    minBitLength = DEFAULT_MIN_BIT_LENGTH,
    limiter = defaultLimiter,
    pool = defaultPool,
} = {}) => {
    if (!rawMessage || (!Buffer.isBuffer(rawMessage) && !(rawMessage instanceof Uint8Array))) {
        return unavailableResult('raw_message_missing');
    }

    if (rawMessage.byteLength === 0) {
        return unavailableResult('raw_message_missing');
    }

    if (rawMessage.byteLength > maxRawBytes) {
        return unavailableResult('raw_message_too_large');
    }

    const safeTimeoutMs = readPositiveInteger(timeoutMs, configuredTimeoutMs);
    const startedAt = Date.now();
    let release;

    try {
        release = await limiter.acquire(safeTimeoutMs);
    } catch (error) {
        return unavailableResult(
            error?.message === 'verification_queue_full'
                ? 'mailauth_busy'
                : 'mailauth_timeout'
        );
    }

    try {
        const remainingTimeoutMs = Math.max(1, safeTimeoutMs - (Date.now() - startedAt));
        return await pool.run({
            rawMessage,
            timeoutMs: remainingTimeoutMs,
            minBitLength,
        });
    } finally {
        release();
    }
};
