// Words of the Projects screen.

import { messages } from '../../i18n/define.ts';

export const PROJECTS = messages(
  {
    title: 'Your projects',
    count: (n: number) => `${n} ${n === 1 ? 'project' : 'projects'}`,
    newProject: 'New project',
    loading: 'Loading projects',
    noProjectsTitle: 'There are no projects yet',
    noProjectsBody: 'Start one with New project.',
    projectsLabel: 'Projects',
    created: 'Created',
    active: 'Active',
    archived: 'Archived',
  },
  {
    title: 'Tus proyectos',
    count: (n: number) => `${n} ${n === 1 ? 'proyecto' : 'proyectos'}`,
    newProject: 'Nuevo proyecto',
    loading: 'Cargando proyectos',
    noProjectsTitle: 'Todavía no hay proyectos',
    noProjectsBody: 'Empieza uno con Nuevo proyecto.',
    projectsLabel: 'Proyectos',
    created: 'Creado',
    active: 'Activo',
    archived: 'Archivado',
  },
);
