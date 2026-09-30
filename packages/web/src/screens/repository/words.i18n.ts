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
    github: 'GitHub',
    githubPrivate: 'Private repository',
    githubFlow: 'Each task is built on its own branch and pull request (GitHub flow).',
    protectionGithub: 'Branch protection: GitHub protects main and requires ci, demiurgo/review and demiurgo/design.',
    protectionDemiurgo:
      'Branch protection: your GitHub plan does not offer it on private repositories, so DEMIURGO itself refuses to merge until ci, demiurgo/review and demiurgo/design are green.',
    githubCreate: 'Create the private repository',
    githubCreating: 'Creating the repository',
    githubCreateBody:
      'Creates a private repository named after the project under your GitHub account, pushes main with design/, and protects main so it needs ci, demiurgo/review and demiurgo/design.',
    githubNotConfigured:
      'GitHub is not connected to this DEMIURGO. Set DEMIURGO_GITHUB_TOKEN and DEMIURGO_GITHUB_OWNER in its environment and restart it.',
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
    github: 'GitHub',
    githubPrivate: 'Repositorio privado',
    githubFlow: 'Cada tarea se construye en su propia rama y pull request (GitHub flow).',
    protectionGithub: 'Protección de rama: GitHub protege main y exige ci, demiurgo/review y demiurgo/design.',
    protectionDemiurgo:
      'Protección de rama: tu plan de GitHub no la ofrece en repositorios privados, así que DEMIURGO mismo se niega a fusionar hasta que ci, demiurgo/review y demiurgo/design estén en verde.',
    githubCreate: 'Crear el repositorio privado',
    githubCreating: 'Creando el repositorio',
    githubCreateBody:
      'Crea un repositorio privado con el nombre del proyecto en tu cuenta de GitHub, sube main con design/ y protege main para que exija ci, demiurgo/review y demiurgo/design.',
    githubNotConfigured:
      'GitHub no está conectado a este DEMIURGO. Define DEMIURGO_GITHUB_TOKEN y DEMIURGO_GITHUB_OWNER en su entorno y reinícialo.',
    files: (n: number) => (n === 1 ? '1 archivo' : `${n} archivos`),
  },
);
