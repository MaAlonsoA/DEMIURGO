// The design-time warning on the approval of a feature: criteria marked automatic whose text states a
// property only the deployed candidate can show (packages/domain/src/criterion-lint.ts). Approving
// anyway needs a reason, which the server keeps in the event.

import { blockingCriterionFindings, type CriterionLintFinding, lintCriteria } from '@demiurgo/domain/criterion-lint';
import { useState } from 'react';
import type { RecordDetail, RecordVersion } from '../../api/types.ts';
import { Notice } from '../../components/Notice.tsx';
import { useMessages } from '../../i18n/define.ts';
import { cn } from '../../lib/cn.ts';
import { CRITERION_LINT } from './words.i18n.ts';

export function useCriterionLint(record: RecordDetail, version: RecordVersion) {
  const [reason, setReason] = useState('');
  const findings: CriterionLintFinding[] =
    record.type === 'fdr'
      ? lintCriteria(
          version.criteria.map((c) => ({
            code: c.code,
            verification: c.verification,
            statement: c.statement,
            check: c.check,
            given: c.given,
            when: c.when,
            then: c.then,
          })),
        )
      : [];
  const blocking = blockingCriterionFindings(findings).length > 0;
  return {
    findings,
    blocking,
    reason,
    setReason,
    /** Data of the approve command. */
    data: blocking && reason.trim() !== '' ? { override_reason: reason.trim() } : {},
    /** The confirm button waits for the reason when there is something to override. */
    missingReason: blocking && reason.trim() === '',
  };
}

export function CriterionLintNotice({ lint }: { lint: ReturnType<typeof useCriterionLint> }) {
  const t = useMessages(CRITERION_LINT);
  if (lint.findings.length === 0) return null;
  const deployed = lint.findings.filter((f) => f.kind === 'needs_deployed_candidate');
  const cited = lint.findings.filter((f) => f.kind === 'depends_on_unbuilt_feature');
  return (
    <div className="flex flex-col gap-3">
      <Notice tone="warning" title={t.title} role="status">
        {deployed.length > 0 ? (
          <>
            <p>{t.intro}</p>
            <ul className="list-disc pl-5">
              {deployed.map((f) => (
                <li key={`${f.criterion_code}-${f.evidence}`}>{t.quoted(f.criterion_code, f.evidence)}</li>
              ))}
            </ul>
          </>
        ) : null}
        {cited.length > 0 ? (
          <ul className="list-disc pl-5">
            {cited.map((f) => (
              <li key={`${f.criterion_code}-${f.evidence}`}>{t.cites(f.criterion_code, f.evidence)}</li>
            ))}
          </ul>
        ) : null}
      </Notice>
      {lint.blocking ? (
        <label className="flex flex-col gap-1.5 text-sm font-medium text-fg">
          {t.reasonLabel}
          <textarea
            rows={3}
            maxLength={2000}
            value={lint.reason}
            onChange={(e) => lint.setReason(e.target.value)}
            className={cn(
              'min-h-20 w-full resize-y rounded-md border border-edge-control bg-panel px-3 py-2 text-base font-normal text-fg',
              'focus:border-focus focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-0',
            )}
          />
          <span className="text-xs font-normal text-fg-3">{t.reasonHint}</span>
        </label>
      ) : null}
    </div>
  );
}
