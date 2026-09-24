// Where DEMIURGO opens ("/"): with no projects, on "What do you want to build?"; with only one,
// inside that project (FDR-INT-001, behavior 1); with more, on the list to choose from.

export type Landing = { to: '/new' } | { to: '/p/$projectId'; projectId: string } | { to: '/projects' };

export function landingOf(projects: readonly { id: string }[]): Landing {
  if (projects.length === 0) return { to: '/new' };
  const only = projects.length === 1 ? projects[0] : undefined;
  return only ? { to: '/p/$projectId', projectId: only.id } : { to: '/projects' };
}
