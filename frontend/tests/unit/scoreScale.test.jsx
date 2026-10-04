import { describe, expect, it } from 'vitest';

import {
  SCORE_STOPS,
  contrastRatio,
  ensureReadable,
  getHealthColor,
  getPostureLabel,
  getRiskColor,
  isScored,
} from '../../src/lib/scoreScale.js';

// The dashboard and the inbox read their numbers in OPPOSITE directions but
// must agree on one thing: red means danger, and the healthy end carries no
// colour at all. Getting it backwards would paint a phishing message calm.

const redness = (hex) => parseInt(hex.slice(1, 3), 16) - parseInt(hex.slice(3, 5), 16);

describe('getHealthColor — 100 is good', () => {
  it('is quiet bone at the top and red at the bottom', () => {
    expect(getHealthColor(100)).toBe('#c9c6bd');
    expect(getHealthColor(0)).toBe('#ea4d52');
  });

  it('lands on every declared stop exactly', () => {
    for (const stop of SCORE_STOPS) {
      expect(getHealthColor(stop.at)).toBe(stop.hex);
    }
  });

  it('interpolates between stops instead of stepping', () => {
    const mid = getHealthColor(92.5);
    expect(mid).not.toBe(getHealthColor(85));
    expect(mid).not.toBe(getHealthColor(100));
  });

  it('gets redder, never calmer, as the value falls', () => {
    let previous = -Infinity;
    for (const value of [100, 85, 70, 55, 40, 20, 0]) {
      const current = redness(getHealthColor(value));
      expect(current).toBeGreaterThan(previous);
      previous = current;
    }
  });

  it('clamps out-of-range and non-numeric input', () => {
    expect(getHealthColor(140)).toBe(getHealthColor(100));
    expect(getHealthColor(-20)).toBe(getHealthColor(0));
    expect(getHealthColor(NaN)).toBe(getHealthColor(0));
    expect(getHealthColor(undefined)).toBe(getHealthColor(0));
  });
});

describe('getRiskColor — 100 is bad, mirroring health', () => {
  it('is red at the top and bone at the bottom', () => {
    expect(getRiskColor(100)).toBe('#ea4d52');
    expect(getRiskColor(0)).toBe('#c9c6bd');
  });

  it('is exactly the health ramp inverted', () => {
    for (const score of [0, 13, 25, 40, 55, 70, 87, 100]) {
      expect(getRiskColor(score)).toBe(getHealthColor(100 - score));
    }
  });

  it('turns amber at the suspicious threshold and orange-red at likely phishing', () => {
    // Backend thresholds: 30 = suspicious, 60 = likely phishing.
    expect(getRiskColor(30)).toBe('#d7a84b');
    expect(getRiskColor(60)).toBe('#f0703f');
  });
});

describe('unscanned messages', () => {
  it('are not treated as scored', () => {
    expect(isScored(null)).toBe(false);
    expect(isScored(undefined)).toBe(false);
    expect(isScored(NaN)).toBe(false);
    expect(isScored(0)).toBe(true);
  });
});

describe('contrast', () => {
  it('every stop is readable as text on the black canvas', () => {
    for (const stop of SCORE_STOPS) {
      expect(contrastRatio(stop.hex)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('ensureReadable leaves a readable colour alone and lifts a dark one', () => {
    expect(ensureReadable('#ea4d52')).toBe('#ea4d52');
    expect(contrastRatio(ensureReadable('#3a1010'))).toBeGreaterThanOrEqual(4.5);
  });
});

describe('getPostureLabel', () => {
  it('reads the rate as a sentence', () => {
    expect(getPostureLabel(100)).toBe('Your inbox is clean');
    expect(getPostureLabel(80)).toBe('A few messages need attention');
    expect(getPostureLabel(10)).toBe('Your inbox needs attention now');
    expect(getPostureLabel(undefined)).toBe('Your inbox needs attention now');
  });
});
