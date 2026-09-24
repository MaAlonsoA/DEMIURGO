// 404: says what was not found, with the way back to the product (spec §7.1).

import { Link, useParams } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { buttonStyles } from '../../ui/Button.tsx';

export function NotFound({ thing = 'this page', children }: { thing?: string; children?: ReactNode }) {
  const { projectId } = useParams({ strict: false }) as { projectId?: string };
  return (
    <main id="main" className="flex min-h-[60vh] flex-col items-center justify-center gap-4 px-6 text-center">
      <h1 className="text-2xl font-semibold">We couldn&apos;t find {thing}.</h1>
      {children && <div className="max-w-md text-sm text-ink-2">{children}</div>}
      {projectId ? (
        <Link to="/p/$projectId" params={{ projectId }} className={buttonStyles({ variant: 'ink' })}>
          Back to the product
        </Link>
      ) : (
        <Link to="/" className={buttonStyles({ variant: 'ink' })}>
          Back to DEMIURGO
        </Link>
      )}
    </main>
  );
}
