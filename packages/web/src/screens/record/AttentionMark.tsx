// The quiet mark of a record or planned feature that has something waiting for the person.

import { Link } from '@tanstack/react-router';
import { useMessages } from '../../i18n/define.ts';
import { cn } from '../../lib/cn.ts';
import { ATTENTION } from './words.i18n.ts';

export function AttentionMark({ projectId, code, className }: { projectId?: string; code: string; className?: string }) {
  const t = useMessages(ATTENTION);
  const cls = cn('inline-flex shrink-0 items-center gap-1.5 text-xs font-medium text-accent-text', className);
  const inner = (
    <>
      <span aria-hidden className="size-1.5 rounded-full bg-accent" />
      {t.waiting}
    </>
  );
  return projectId ? (
    <Link to="/p/$projectId/records/$code" params={{ projectId, code }} data-attention={code} className={cn(cls, 'hover:underline')}>
      {inner}
    </Link>
  ) : (
    <span data-attention={code} className={cls}>
      {inner}
    </span>
  );
}
