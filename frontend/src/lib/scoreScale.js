// ─────────────────────────────────────────────────────────────────────────────
// scoreScale.js — the continuous 0–100 colour ramp shared by the dashboard
// gauge and every risk score in the inbox.
//
// risk.js maps a CATEGORY (safe / needs_review / quarantine / …) to a colour and
// stays the single source of truth for badges, charts and filters. A *number*
// wants a continuous ramp instead — 68 and 71 should not look identical just
// because they share a bucket. This file owns that ramp and nothing else.
//
// The ramp is warm and one-directional: quiet bone at the healthy end, then
// amber, orange-red and red. "Healthy" is deliberately NOT green: safe is the
// absence of alarm, so it carries no colour of its own. Red is reserved for
// the dangerous end, so the only chromatic things on a screen are warnings.
//
// Two screens read the ramp in opposite directions:
//   - dashboard safe rate: 100 is GOOD  -> getHealthColor(100) = bone
//   - inbox risk score:    100 is BAD   -> getRiskColor(100)   = red
// getRiskColor is literally getHealthColor(100 - score).
// ─────────────────────────────────────────────────────────────────────────────

// Healthiest first. The stops sit on the backend's verdict thresholds (30 =
// suspicious, 60 = likely phishing, read as 70 / 40 on the health axis) so the
// colour of a number agrees with the word next to it.
const STOPS = [
  { at: 100, hex: '#c9c6bd' }, // bone        — nothing to do
  { at: 85, hex: '#c0b89b' }, // warm bone
  { at: 70, hex: '#d7a84b' }, // amber       — suspicious begins here
  { at: 55, hex: '#e38f3c' }, // orange
  { at: 40, hex: '#f0703f' }, // orange-red  — likely phishing begins here
  { at: 20, hex: '#ec5b47' },
  { at: 0, hex: '#ea4d52' }, // red         — act now
];

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

const toRgb = (hex) => [
  parseInt(hex.slice(1, 3), 16),
  parseInt(hex.slice(3, 5), 16),
  parseInt(hex.slice(5, 7), 16),
];

const toHex = (rgb) =>
  `#${rgb.map((c) => clamp(Math.round(c), 0, 255).toString(16).padStart(2, '0')).join('')}`;

/**
 * Colour for a 0–100 "health" value where 100 is best. Blends linearly between
 * the two neighbouring stops, so a value sliding from 71 to 69 shifts colour
 * gradually instead of snapping.
 */
export function getHealthColor(value) {
  const v = Number.isFinite(value) ? clamp(value, 0, 100) : 0;

  for (let i = 0; i < STOPS.length - 1; i += 1) {
    const hi = STOPS[i];
    const lo = STOPS[i + 1];
    if (v <= hi.at && v >= lo.at) {
      const span = hi.at - lo.at;
      const t = span === 0 ? 0 : (v - lo.at) / span;
      const a = toRgb(lo.hex);
      const b = toRgb(hi.hex);
      return toHex([0, 1, 2].map((c) => a[c] + (b[c] - a[c]) * t));
    }
  }
  return STOPS[STOPS.length - 1].hex;
}

/**
 * Colour for a 0–100 RISK score where 100 is worst.
 *
 * An unscanned message has score `null`, and "no risk recorded" is not the same
 * claim as "this is safe". Callers must test `isScored()` first and fall back
 * to UNSCORED_COLOR.
 */
export const getRiskColor = (score) =>
  getHealthColor(100 - (Number.isFinite(score) ? clamp(score, 0, 100) : 0));

/** True only when a real numeric score exists to colour. */
export const isScored = (score) => Number.isFinite(score);

/** Neutral grey for unscanned/unknown — never a ramp colour. */
export const UNSCORED_COLOR = 'var(--color-risk-unscanned)';

// ── Contrast ────────────────────────────────────────────────────────────────
// Ramp colours are used as large tinted numerals on the canvas; they have to
// stay legible, and the guarantee lives in code rather than in a comment.

// Must track --color-background in index.css.
const BACKGROUND = '#000000';

const relativeLuminance = (hex) => {
  const [r, g, b] = toRgb(hex).map((c) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

export const contrastRatio = (fg, bg = BACKGROUND) => {
  const a = relativeLuminance(fg);
  const b = relativeLuminance(bg);
  const [hi, lo] = a > b ? [a, b] : [b, a];
  return (hi + 0.05) / (lo + 0.05);
};

/**
 * Nudges a colour toward white until it clears `min` contrast on the page
 * background. Every stop already passes 4.5:1 on black; this is a guard that
 * only bites if someone retunes a stop darker.
 */
export function ensureReadable(hex, min = 4.5, bg = BACKGROUND) {
  let out = hex;
  for (let step = 0; step < 20 && contrastRatio(out, bg) < min; step += 1) {
    const rgb = toRgb(out).map((c) => c + (255 - c) * 0.08);
    out = toHex(rgb);
  }
  return out;
}

/** Health ramp colour, guaranteed readable as text on the canvas. */
export const getHealthTextColor = (value) => ensureReadable(getHealthColor(value));

/** Risk ramp colour, guaranteed readable as text on the canvas. */
export const getRiskTextColor = (score) => ensureReadable(getRiskColor(score));

/**
 * A short, plain-language reading of a safe rate, so the dashboard states a
 * conclusion instead of leaving the user to interpret a bare percentage.
 */
export function getPostureLabel(safeRate) {
  const v = Number.isFinite(safeRate) ? clamp(safeRate, 0, 100) : 0;
  if (v >= 95) return 'Your inbox is clean';
  if (v >= 85) return 'Your inbox is healthy';
  if (v >= 70) return 'A few messages need attention';
  if (v >= 50) return 'Several messages need attention';
  return 'Your inbox needs attention now';
}

export const SCORE_STOPS = STOPS;
