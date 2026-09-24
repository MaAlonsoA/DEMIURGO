// Every project screen: the header, always visible, the page and the event stream (spec §3 and §8).

import { Outlet } from '@tanstack/react-router';
import { useProjectId } from '../../lib/hooks.ts';
import { ConnectionBanner, useProjectStream } from '../../api/stream.ts';
import { Header } from './Header.tsx';

export function ProjectShell() {
  const projectId = useProjectId();
  useProjectStream(projectId);
  return (
    <div className="min-h-screen">
      <Header />
      <ConnectionBanner />
      <Outlet />
    </div>
  );
}
