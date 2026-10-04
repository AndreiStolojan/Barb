import { describe, expect, it } from 'vitest';

import {
  AI_SCORE_MAX,
  RULE_SCORE_MAX,
  SCORE_MAX,
  getAiStatus,
} from '../../src/lib/scoring.js';

// Mirrors the proportional fill formula used by ScoreBar: (value / max) * 100, clamped.
const fillPct = (value, max) =>
  Math.max(0, Math.min(100, (Number(value) / max) * 100 || 0));

describe('score bar proportionality', () => {
  it('fills against the true maximum, not the local value', () => {
    expect(fillPct(0, SCORE_MAX)).toBe(0); // empty
    expect(fillPct(SCORE_MAX, SCORE_MAX)).toBe(100); // full
    expect(fillPct(50, 100)).toBe(50); // 50/100 -> 50%
    expect(Math.round(fillPct(50, 85))).toBe(59); // 50/85 -> ~59%
  });

  it('renders a maxed-out AI score as a full bar (AI_SCORE_MAX, not SCORE_MAX)', () => {
    expect(AI_SCORE_MAX).toBeLessThan(SCORE_MAX);
    expect(fillPct(AI_SCORE_MAX, AI_SCORE_MAX)).toBe(100);
    // Same value against the wrong denominator would wrongly read as half-full.
    expect(fillPct(AI_SCORE_MAX, SCORE_MAX)).toBe(50);
    expect(RULE_SCORE_MAX).toBe(SCORE_MAX);
  });
});

describe('getAiStatus', () => {
  it('reports ok when the model generated an explanation', () => {
    const scan = {
      aiExplanationMeta: { status: 'generated' },
      aiSignals: { status: 'evaluated' },
    };
    expect(getAiStatus(scan)).toEqual({ state: 'ok', message: null });
  });

  it('reports disabled (calm) when AI is turned off', () => {
    const scan = {
      aiExplanationMeta: { status: 'fallback', fallbackReason: 'ai_disabled' },
      aiSignals: { status: 'disabled', disabledReason: 'ai_disabled' },
    };
    const result = getAiStatus(scan);
    expect(result.state).toBe('disabled');
    expect(result.message).toMatch(/turned off/i);
  });

  it('distinguishes timeout, unreachable, and malformed failures', () => {
    const make = (reason, signalError) => ({
      aiExplanationMeta: { status: 'fallback', fallbackReason: reason },
      aiSignals: { status: 'failed', error: signalError },
    });
    expect(getAiStatus(make('ollama_timeout', 'ollama_timeout')).state).toBe('timeout');
    expect(getAiStatus(make('ollama_unreachable', 'ollama_unreachable')).state).toBe('unavailable');
    expect(getAiStatus(make('ollama_invalid_output:invalid_json', 'ollama_invalid_output')).state).toBe('error');
  });

  it('never throws on a missing or empty scan', () => {
    expect(getAiStatus(null)).toEqual({ state: 'ok', message: null });
    expect(getAiStatus({}).state).toBe('ok');
  });
});

describe('getAiStatus after AI gating', () => {
  it('reports skipped when rules decided the verdict alone', () => {
    const scan = {
      aiExplanationMeta: { status: 'template', fallbackReason: 'ai_not_needed' },
      aiSignals: { status: 'skipped', skippedReason: 'verdict_decided_by_rules' },
    };
    expect(getAiStatus(scan).state).toBe('skipped');
    // The inbox list carries only the explanation metadata.
    expect(getAiStatus({ aiExplanationMeta: scan.aiExplanationMeta }).state).toBe('skipped');
  });

  it('reports ok for a template explanation over evaluated signals', () => {
    const scan = {
      aiExplanationMeta: { status: 'template', fallbackReason: null },
      aiSignals: { status: 'evaluated' },
    };
    expect(getAiStatus(scan)).toEqual({ state: 'ok', message: null });
  });
});
