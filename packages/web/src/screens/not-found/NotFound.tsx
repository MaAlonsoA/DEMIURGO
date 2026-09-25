// Not found (DESIGN.md §2, §5): says what was not found and offers one way back. Screens render it
// inline, inside the project shell ("this thread", "the record FDR-…"); the router renders it for
// an unknown route or an unknown project, where there is no shell around it — then it brings its
// own slim frame and main landmark (no tooltips there: the app root may not be mounted). It never
// links back to a project that doesn't exist (INVENTORY §4): only a known project gets "Back to
// the product"; anything else goes back to DEMIURGO.

import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from '@tanstack/react-router';
import { type ReactNode, useLayoutEffect, useRef, useState } from 'react';
import { projectsQuery } from '../../api/queries.ts';
import { buttonClass } from '../../components/Button.tsx';
import { ArrowLeftIcon, SearchIcon } from '../../components/icons.tsx';
import { usePageTitle } from '../../components/Page.tsx';
import { Wordmark } from '../../shell/WorkspaceFrame.tsx';

export function NotFound({ thing = 'this page', children }: { thing?: string; children?: ReactNode }) {
  usePageTitle(['Not found']);
  const { projectId } = useParams({ strict: false }) as { projectId?: string };
  const known = (useQuery(projectsQuery).data ?? []).some((p) => p.id === projectId);
  const probe = useRef<HTMLDivElement>(null);
  // Inside the shell there is already a <main>; at the router's level there is none to sit in.
  const [framed, setFramed] = useState<boolean | null>(null);
  useLayoutEffect(() => {
    if (framed === null) setFramed(!probe.current?.closest('main'));
  }, [framed]);

  const body = (
    <div
      ref={probe}
      data-not-found
      className="mx-auto flex w-full max-w-xl flex-1 flex-col items-center justify-center gap-4 px-6 py-20 text-center"
    >
      <span aria-hidden className="flex h-12 w-12 items-center justify-center rounded-full bg-sunken text-fg-3">
        <SearchIcon size={22} />
      </span>
      <h1 id="page-title" tabIndex={-1} className="text-xl font-semibold text-fg outline-none">
        We couldn&apos;t find {thing}.
      </h1>
      {children ? <div className="max-w-md text-md text-fg-2">{children}</div> : null}
      <div className="mt-2">
        {projectId && known ? (
          <Link to="/p/$projectId" params={{ projectId }} className={buttonClass({ variant: 'secondary' })}>
            <ArrowLeftIcon size={15} />
            Back to the product
          </Link>
        ) : (
          <Link to="/" className={buttonClass({ variant: 'secondary' })}>
            <ArrowLeftIcon size={15} />
            Back to DEMIURGO
          </Link>
        )}
      </div>
    </div>
  );

  if (!framed) return body;
  return (
    <div className="flex min-h-screen flex-col bg-app font-ui text-fg">
      <header className="flex h-14 shrink-0 items-center px-4 sm:px-6">
        <Wordmark />
      </header>
      <main id="main" tabIndex={-1} className="flex flex-1 flex-col outline-none sm:px-2 sm:pb-2">
        <div className="flex flex-1 flex-col bg-panel sm:rounded-lg sm:border sm:border-edge">{body}</div>
      </main>
    </div>
  );
}
