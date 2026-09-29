// The words of the project's repository page (Repository.tsx).

import { messages } from '../../i18n/define.ts';

export const REPOSITORY = messages(
  {
    eyebrow: 'Project settings',
    title: 'Repository',
    meta: 'DEMIURGO writes what you accept and approve to this folder, as design/, one commit per change. Change it in DEMIURGO, not in the folder.',
    loading: 'Loading the repository',
    folder: 'Folder',
    commits: 'Commits',
    none: 'No repository yet',
    noneBody: 'It is created with the first thing you accept or approve in this project.',
    you: 'you',
    files: (n: number) => (n === 1 ? '1 file' : `${n} files`),
  },
  {
    eyebrow: 'Ajustes del proyecto',
    title: 'Repositorio',
    meta: 'DEMIURGO escribe en esta carpeta, como design/, lo que aceptas y apruebas, un commit por cambio. Cámbialo en DEMIURGO, no en la carpeta.',
    loading: 'Cargando el repositorio',
    folder: 'Carpeta',
    commits: 'Commits',
    none: 'Todavía no hay repositorio',
    noneBody: 'Se crea con lo primero que aceptes o apruebes en este proyecto.',
    you: 'tú',
    files: (n: number) => (n === 1 ? '1 archivo' : `${n} archivos`),
  },
);
