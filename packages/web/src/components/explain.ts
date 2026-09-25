// What an error means in product words (DESIGN.md §5): a title for each status and the server's
// reasons as they come, never a bare "Error" (R44). Pure: the notices and the tests use it.

import { ApiError } from '../api/client.ts';
import { PRODUCT_WORDS } from '../words.ts';

export type Explained = { title: string; reasons: string[] };

const KNOWLEDGE_BEHIND = /knowledge is not up to date|knowledge.*not.*current/i;

export function explain(error: unknown): Explained {
  if (!(error instanceof ApiError)) {
    return { title: 'Something went wrong on our side. Nothing was changed.', reasons: [] };
  }
  const reasons = error.reasons.length > 0 ? error.reasons : error.message ? [error.message] : [];
  switch (error.status) {
    case 0:
      return { title: "Can't reach DEMIURGO. Check your connection and try again.", reasons: [] };
    case 401:
      return { title: 'Your session ended. Sign in again to continue.', reasons: [] };
    case 403:
      return {
        title: /person|human/i.test(error.message) ? PRODUCT_WORDS.onlyAPerson : PRODUCT_WORDS.notAllowed,
        reasons: [error.message],
      };
    case 404:
      return { title: `We couldn't find it. ${error.message}`.trim(), reasons: [] };
    case 409:
      if ([error.message, ...error.reasons].some((r) => KNOWLEDGE_BEHIND.test(r))) {
        return { title: PRODUCT_WORDS.catchingUp, reasons: error.reasons.length ? error.reasons : [error.message] };
      }
      return {
        title: error.reasons.length ? error.message : "It can't be done right now.",
        reasons: error.reasons.length ? error.reasons : [error.message],
      };
    case 422:
      return { title: 'Some of what you wrote needs a change.', reasons };
    default:
      return { title: 'Something went wrong on our side. Nothing was changed.', reasons: error.message ? [error.message] : [] };
  }
}

/** A reason that asks the person to choose an engine (FDR-AGE-002): it links to Models & providers. */
export const ENGINE_REASON = /Choose (a|another) model for /;

/** Is this a 404 (the thing isn't there, or belongs to another project)? */
export function isNotFound(error: unknown): boolean {
  return error instanceof ApiError && error.status === 404;
}
