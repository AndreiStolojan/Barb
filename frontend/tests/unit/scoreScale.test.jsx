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
// must agree on one thing: rose means danger, mint means nothing to do.
// Getting it backwards would paint a phishing message calm.

describe('getHealthColor — 100 is good', () => {
  it('is mint at the top and rose at the bottom', () => {
    expect(getHealthColor(100)).toBe('#8ccbb0');
    expect(getHealthColor(0)).toBe('#f1677d');
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

  it('loses green, never gains it, as the value falls', () => {
    const green = (hex) => parseInt(hex.slice(3, 5), 16);
    let previous = Infinity;
    for (const value of [100, 70, 55, 40, 20, 0]) {
      const current = green(getHealthColor(value));
      expect(current).toBeLessThan(previous);
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
  it('is rose at the top and mint at the bottom', () => {
    expect(getRiskColor(100)).toBe('#f1677d');
    expect(getRiskColor(0)).toBe('#8ccbb0');
  });

  it('is exactly the health ramp inverted', () => {
    for (const score of [0, 13, 25, 40, 55, 70, 87, 100]) {
      expect(getRiskColor(score)).toBe(getHealthColor(100 - score));
    }
  });

  it('turns amber at the suspicious threshold and coral at likely phishing', () => {
    // Backend thresholds: 30 = suspicious, 60 = likely phishing.
    expect(getRiskColor(30)).toBe('#f1bb63');
    expect(getRiskColor(60)).toBe('#ff8e7c');
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
  it('every stop is readable as text on the panel', () => {
    for (const stop of SCORE_STOPS) {
      expect(contrastRatio(stop.hex)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('ensureReadable leaves a readable colour alone and lifts a dark one', () => {
    expect(ensureReadable('#f1677d')).toBe('#f1677d');
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
