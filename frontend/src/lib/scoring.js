// Scalele afișate în UI oglindesc backend/src/config/scoring.config.js.
// Valorile sunt definite separat aici și trebuie păstrate în sincron cu backend-ul.
// getAiStatus traduce metadatele analizei AI în mesaje pentru utilizator.
// Vezi docs/detection-engine.md.

// Capătul scalei de scor; scorul final e limitat (clamp) la această valoare în backend.
export const SCORE_MAX = 100;

// Plafonul scorului AI (rămâne sub pragul de likely_phishing).
// Bara "AI" trebuie desenată față de această valoare, nu față de SCORE_MAX,
// altfel un scor AI maxim (50) ar umple bara doar pe jumătate.
export const AI_SCORE_MAX = 50;

// Sub-scorul de reguli folosește aceeași scală 0–100, deci bara lui se desenează față de SCORE_MAX.
export const RULE_SCORE_MAX = SCORE_MAX;

// AI_MESSAGES — un mesaj prietenos pentru fiecare "stare" posibilă a analizei AI
// asupra unui scan. getAiStatus() decide care dintre aceste mesaje se arată.
const AI_MESSAGES = {
  disabled: 'AI analysis is turned off. Showing the rule-based score only.',
  skipped: 'The rules decided this verdict on their own, so the AI model was not run.',
  unavailable: 'AI analysis is unavailable right now. Showing the rule-based score.',
  timeout: 'AI analysis timed out. Showing the rule-based score — results may be incomplete.',
  error: "AI analysis couldn't be completed. Showing the rule-based score.",
};

// getAiStatus(scan) — analizează metadatele salvate ale unui scan și decide ce
// mesaj despre AI să arate UI-ul.
// Întoarce { state, message }: `message` e null când AI a funcționat normal.
// Lista de emailuri trimite doar `aiExplanationMeta`, deci motivul se citește
// de acolo dacă `aiSignals` lipsește. Explicația vine din șablon (`template`)
// sau, la scanări vechi, de la model (`generated`); ambele sunt normale.
export function getAiStatus(scan) {
  if (!scan) return { state: 'ok', message: null };

  const meta = scan.aiExplanationMeta || {};
  const signals = scan.aiSignals || {};
  const reason = String(
    meta.fallbackReason || signals.disabledReason || signals.error || ''
  ).toLowerCase();

  if (signals.status === 'skipped' || reason === 'ai_not_needed') {
    return { state: 'skipped', message: AI_MESSAGES.skipped };
  }
  if (reason.includes('disabled') || signals.status === 'disabled') {
    return { state: 'disabled', message: AI_MESSAGES.disabled };
  }
  if (reason.includes('timeout')) {
    return { state: 'timeout', message: AI_MESSAGES.timeout };
  }
  if (reason.includes('unreachable')) {
    return { state: 'unavailable', message: AI_MESSAGES.unavailable };
  }
  if (
    reason ||
    signals.status === 'failed' ||
    (meta.status && !['generated', 'template'].includes(meta.status))
  ) {
    return { state: 'error', message: AI_MESSAGES.error };
  }

  return { state: 'ok', message: null };
}
