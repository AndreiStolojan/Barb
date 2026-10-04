// Runs mailauth outside the API event loop so a large message or slow crypto
// operation cannot block unrelated requests. The parent reuses this worker for
// one message at a time, owns the hard timeout and terminates the worker if the
// deadline expires.

import { parentPort } from 'node:worker_threads';

import { verifyWithMailauth } from './mailauth-verifier.core.js';

parentPort.on('message', async ({ id, rawMessage, minBitLength }) => {
    try {
        const result = await verifyWithMailauth(Buffer.from(rawMessage), { minBitLength });

        parentPort.postMessage({ id, ok: true, result });
    } catch {
        // Do not send library/DNS error text across the boundary. It may contain
        // attacker-controlled selector/domain data and is not needed by callers.
        parentPort.postMessage({ id, ok: false });
    }
});
