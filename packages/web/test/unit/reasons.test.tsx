import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ApiError } from '../../src/api/client.ts';
import { Reasons, explain } from '../../src/ui/Reasons.tsx';

describe('reasons of a rejected action', () => {
  it('AC-INT-001-14 a 409 shows the server reasons as they come, never a generic "Error"', () => {
    const e = explain(
      new ApiError(409, 'guard', 'The command cannot be run.', ['Version 2 is not approved.', 'It has no acceptance criteria.']),
    );
    expect(e.title).toBe('The command cannot be run.');
    expect(e.reasons).toEqual(['Version 2 is not approved.', 'It has no acceptance criteria.']);
    const html = renderToStaticMarkup(
      <Reasons error={new ApiError(409, 'guard', 'The command cannot be run.', ['Version 2 is not approved.'])} />,
    );
    expect(html).toContain('Version 2 is not approved.');
    expect(html).toContain('role="alert"');
    expect(html).not.toMatch(/>Error</);
  });

  it('AC-INT-001-14 a 422 says what to change, with its reasons', () => {
    const e = explain(
      new ApiError(422, 'validation', 'Invalid data.', ['purpose: Too small: expected string to have >=1 characters']),
    );
    expect(e.title).toBe('Some of what you wrote needs a change.');
    expect(e.reasons).toHaveLength(1);
  });

  it('AC-INT-001-14 a 403 explains that the action belongs to a person or is not allowed', () => {
    expect(explain(new ApiError(403, 'forbidden', 'Only a human can run this command.', [])).title).toBe(
      'Only a person can do this.',
    );
    expect(explain(new ApiError(403, 'forbidden', 'The session CSRF token is missing or invalid.', [])).title).toBe(
      "This isn't allowed here.",
    );
  });

  it('AC-INT-001-14 a 409 because the knowledge is behind says DEMIURGO is catching up', () => {
    const e = explain(
      new ApiError(409, 'guard', 'The command cannot be run.', [
        "The project's knowledge is not up to date: 1 update(s) are still pending. Try again once it finishes.",
      ]),
    );
    expect(e.title).toBe('DEMIURGO is catching up with your latest changes. Try again in a moment.');
    expect(e.reasons[0]).toMatch(/not up to date/);
  });

  it('AC-INT-001-14 a 404 says what was not found and no status is ever just "Error"', () => {
    expect(explain(new ApiError(404, 'not_found', 'The batch does not exist.', [])).title).toBe(
      "We couldn't find it. The batch does not exist.",
    );
    for (const status of [0, 401, 403, 404, 409, 422, 500]) {
      expect(explain(new ApiError(status, 'x', 'Something.', [])).title).not.toMatch(/^Error$/);
    }
  });
});
