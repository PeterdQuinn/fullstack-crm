// The score bar, defined once.
//
// Six places gated on a bare `> 50`: the automation send phase, the manual
// email queue, single-lead send, the research-center approval, the admin KPI
// and the Send button in the leads table. They have to agree — a button that
// is enabled while the API refuses is worse than either rule on its own.

/** Real scores below this are retired (archived) after scoring. */
export const SCORE_KEEP_THRESHOLD = 20;

/** Minimum score to email a lead. */
export const SCORE_SEND_THRESHOLD = 20;

/**
 * The score lib/ai-scoring.ts writes when EVERY provider failed. It means "never
 * evaluated", not "scored 50". lead_ai_summaries has no provider column, so an
 * exact 50 cannot be told apart from a genuine one after the fact and is
 * excluded — the same exclusion the old `> 50` gate made by accident.
 */
export const FALLBACK_SCORE = 50;

/** True when this score permits an outbound email. */
export function scoreAllowsSend(score: number | null | undefined): boolean {
  const value = Number(score);
  return Number.isFinite(value) && value >= SCORE_SEND_THRESHOLD && value !== FALLBACK_SCORE;
}
