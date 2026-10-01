// When the reviewer's run ends without a verdict because the provider had a passing problem, the attempt does not end:
// the review is requested again. Waiting longer and trying again is the standard answer to overload and rate limits
// (Beyer, Jones, Petoff and Murphy, "Site Reliability Engineering", ch. 21 "Handling Overload":
// sre.google/sre-book/handling-overload/, which recommends retrying with backoff and a bounded number of retries).
// The two retries and the 30 s then 120 s waits are «convención nuestra».

import { isQuotaError } from '@demiurgo/domain';

/** Retries of the reviewer's run per attempt (our convention). */
export const REVIEW_MAX_RETRIES = 2;

/** Wait before retry number `retry` (1-based): 30 s, then 120 s (our convention). */
export const REVIEW_RETRY_BACKOFF_MS = [30_000, 120_000] as const;

const TRANSIENT_WORDS =
  /at capacity|over ?capacity|overloaded|try again|temporarily unavailable|service unavailable|bad gateway|gateway time-?out|internal server error|\b(?:500|502|503|504|529)\b|ECONNRESET|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|EPIPE|socket hang up|fetch failed|network (?:error|connection)|connection (?:reset|closed|error)|stream (?:disconnected|closed)/i;

/** Whether a run's error text says something that waiting fixes: capacity, overload, rate or usage limit, 429/5xx, network. */
export function isTransientRunError(message: string | null | undefined): boolean {
  if (!message) return false;
  return isQuotaError(message) || TRANSIENT_WORDS.test(message);
}
