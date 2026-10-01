// The one trivial rule of the first version: how many attempts a request took (`attempts` unit, class `info`).

import type { Rule } from './index.ts';

export const requestShape: Rule = (inputs) => {
  const attempts = new Set(inputs.steps.map((s) => s.attempt)).size;
  if (attempts === 0) return [];
  return [
    {
      piece: 'B24',
      finding: 'request.attempts',
      class: 'info',
      ground_truth: 'G07',
      value: attempts,
      unit: 'attempts',
      subject: inputs.taskCode,
      evidence: { build_request: inputs.request.id },
    },
  ];
};
