# Explainable Detection Engine

SecureInbox scores each synced email from 0 to 100. Deterministic evidence is
the primary source of a verdict; local Ollama semantic evidence is additive and
capped. The engine persists the score split, triggered rules, raw AI result,
and provider execution metadata with the scan.

| Score | Verdict |
| --- | --- |
| 0-29 | Safe |
| 30-59 | Suspicious |
| 60-100 | Likely phishing |

AI contributes at most 50 points, below the 60-point phishing threshold, so AI
cannot produce a phishing verdict by itself. This is explainability by
construction: the UI can show the verdict, score split, and triggered evidence.
It does not claim SHAP, LIME, a trained classifier, or precision/recall metrics.

## Architecture

`scan.service.js` remains the orchestration and persistence boundary. It loads
the email, resolves sender-list and brand context, builds AI input, creates a
`DetectionContext`, calls `runDetection(ctx)`, generates the explanation, and
upserts the `Scan` record. Rule evaluation itself lives under
`backend/src/detection/`:

| Module | Responsibility |
| --- | --- |
| `context.js` | Creates the read-only context shared by providers. |
| `registry.js` | Holds the ordered provider list, validates the contract, isolates failures, and records provider-outcome metrics. |
| `providers/*.provider.js` | Extracts point-free evidence from one concern. |
| `weights/*.weights.js` | Holds the base-point table split by domain. |
| `weights/index.js` | Merges weights and throws at import time when any signal key is duplicated. |
| `scorer.js` | Looks up weights, applies modifiers and caps, builds reasons/triggered rules, and maps the verdict. |
| `index.js` | Runs providers, scores their signals, and returns the detection result. |

The built-in providers run in this order: `sender-list`, `email-auth`,
`reply-to`, `link-analysis`, `attachment-extension`, then `ai-semantic`. The order is
observable because it preserves triggered-rule ordering.

Signals also carry a global numeric `order` used by the scorer. This preserves
legacy evidence order even when one provider emits evidence on both sides of
another provider (link patterns before attachment evidence, link-count evidence
after it). New providers must choose order values against the existing global
sequence and add a mixed-provider ordering test.

### Detection context

`createDetectionContext()` freezes the context wrapper and its plain-object
subcontexts. It supplies `email`, `senderListContext`, `brandContext`, `authResults`,
`scanContext`, `userSettings`, `aiInput`, and the injected `semanticAnalyzer`.
The Mongoose email document is intentionally not deep-frozen, so providers must
treat every value in the context as read-only. Providers must not write to the
database; scan persistence stays in `scan.service.js`.

## Provider contract and failure isolation

Every provider module exports a stable metadata object and an async `analyze`
function:

```js
export const meta = Object.freeze({
  id: 'link-analysis', // stable and unique; used in logs and metrics
  version: 1,          // increment when the provider logic changes
  kind: 'rule',        // 'rule' or 'ai'; selects the scoring bucket
  optional: false,     // expected failures log at debug level when true
});

export async function analyze(ctx) {
  return { signals: [], status: 'skipped', meta: {} };
}
```

`signals` must be an array. The registry-enforced minimum is a non-empty
`key`. The architectural Signal shape is `{ key: string, details?: string |
object }`; the current providers preserve legacy display fields: `rule`,
`reason`, a string `details`, and `order`; the final
`triggeredRules.details` schema is also a string. A provider must never return
`points`: the registry rejects it. The
registry adds the provider kind, provider id, and sequence before passing a
signal to the scorer.

The registry runs providers one at a time inside `try/catch`. A thrown error or
invalid provider result produces no signals from that provider, records
`{ provider, version, kind, status: 'error', message }` in the scan's
`providerMeta`, and allows the other providers and the scan to complete.
Successful or skipped providers are recorded too. Optional-provider failures
log at debug level; required-provider failures log as errors. Each outcome
increments `secureinbox_detection_provider_total{provider,result}`, where
`provider` comes from the finite registry and `result` is limited to
`success`, `error`, or `skipped`.

The AI provider is optional. If it fails, `runDetection()` supplies the normal
failed-AI fallback payload so explanation generation remains deterministic.

The AI provider runs last and receives the rule signals collected before it.
It skips the model call, recording `aiSignals.status: 'skipped'`, when rules
alone fix the verdict: with a rule score of 0, AI is capped below
`suspicious`, and at `likelyPhishing` or above it can only add points. On the
Raspberry Pi each call costs tens of seconds at full CPU. The explanation is
always the deterministic template in `scan-explanation.service.js`, which
includes the AI signals when the semantic call succeeded.

## Centralized scoring

Providers describe evidence only. `scorer.js` is the only code that assigns
points, in this order:

1. It resolves each signal key in the merged rule or AI weight table.
2. It applies the existing verified-brand and user-allowlist modifiers, taking
   the lowest applicable multiplier.
3. It sums rule signals into `ruleScore`, sums AI signals into `aiScore`, and
   caps AI at `AI_SCORE_MAX`.
4. It caps `ruleScore + aiScore` at `SCORE_MAX`.
5. It maps the total using `RISK_THRESHOLDS`.

`scoring.config.js` remains the place for thresholds, caps, modifiers, and
their invariants. Domain weight files contain the base points. The
`user_blocklist_match` signal is intentionally an exception: it receives
`USER_BLOCKLIST_RULE_POINTS` (the phishing threshold) rather than a normal
weight, bypasses score modifiers, and blocklisted senders suppress the verified
brand context before detection begins. Preserve that behavior when changing the
engine.

## Adding providers and weighted signals

Before changing either, add or update the golden fixture/test coverage. A
signal key is global across all weight modules; duplicate keys fail at module
import rather than silently overriding one another.

### Add a provider

1. Create `backend/src/detection/providers/<name>.provider.js`, exporting the
   contract above. Give it a unique, stable id and return point-free signals.
2. Import the module and place it deliberately in `DEFAULT_PROVIDERS` in
   `backend/src/detection/registry.js`. Position matters for evidence order.
3. If the provider emits weighted signals, complete the signal steps below.

Provider metric labels remain bounded by the validated, finite
`DEFAULT_PROVIDERS` registry. No separate metrics allow-list needs editing, so
registering a provider that uses existing signal keys is exactly the advertised
two-file change: the provider module and `registry.js`.

### Add a weighted signal

1. Choose a globally unique key and whether it is a `rule` or `ai` signal. The
   provider's `meta.kind` must match the weight bucket.
2. Emit `{ key, rule, reason, details, order }` from the relevant provider;
   do not add `points`.
3. Add the base points for that exact key to the appropriate domain module in
   `backend/src/detection/weights/` (`link`, `attachment`, `sender`, or `ai`).
   Keep thresholds, caps, and modifier tables in `scoring.config.js`; add a
   modifier there only when the intended existing context behavior requires it.
4. Verify the golden output and the duplicate-key test. An unknown key reaches
   the scorer as an error, so do not register a provider signal without its
   weight.

There are two honest file-count cases for a new weighted signal:

| Change | Files for the signal itself |
| --- | --- |
| Signal belongs to an existing provider | 2: that provider and its weight module. |
| Signal requires a new provider | 3: the new provider, `registry.js`, and its weight module. |

The two-versus-three distinction describes the complete runtime change; metrics
derive their bounded provider-id set from the validated production registry.

## Preserved compatibility behavior

Existing synchronous helpers, `calculateRulesForEmail` and
`calculateAiScoreFromSignals`, remain as compatibility façades in
`scan.service.js`; they delegate to provider collectors and `scoreSignals`.
They are not the live scan path. See `FOLLOWUPS.md` for intentionally preserved
behavior that should not be changed as part of a behavior-preserving refactor.

## Email authentication

Gmail authentication uses a deliberately hybrid trust model:

- SPF comes only from the single unambiguous `Authentication-Results` header
  whose authentication service is `mx.google.com`. SPF cannot be repeated after
  delivery because the original SMTP client IP is no longer trustworthy.
- DKIM and ARC are verified locally over the exact `format=raw` RFC 822 bytes
  with `mailauth`. Verification runs in a bounded worker and the raw message is
  discarded immediately; only normalized outcomes are persisted.
- DMARC is evaluated locally from trusted SPF and locally verified DKIM identities
  against a cached `_dmarc` TXT policy. Organizational-domain matching uses the
  Public Suffix List. Native Node TXT lookups do not expose TTLs, so positive and
  negative policies use a conservative one-hour cache lifetime.

Authentication is evaluated during Gmail synchronization, before detection.
The `email-auth` provider performs no network or database work; it only converts
the persisted outcome into point-free evidence. A valid ARC chain suppresses SPF
and DKIM failure signals for forwarding, but does not turn DMARC into pass, grant
verified-brand status, or suppress unrelated phishing evidence.

A known brand receives score reductions only when its domain matches the brand
configuration and aligned DMARC passes. A matching but unauthenticated claim
receives no reduction. If Gmail, DNS, raw-message retrieval, or cryptographic
verification is unavailable, authentication emits zero signals and never grants
brand verification; the remaining detection providers still complete the scan.
