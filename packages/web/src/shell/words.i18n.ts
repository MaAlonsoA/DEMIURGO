// The words of the app shell (DESIGN.md §2): the sidebar, the top bars, the command menu, the
// connection banner, dev tools and Help. Screen content has its own catalogs; this one holds only
// what the frame itself says.

import { messages } from '../i18n/define.ts';

export const APP_ROOT = messages({ skipToContent: 'Skip to content' }, { skipToContent: 'Saltar al contenido' });

export const NAV_LABELS = messages(
  {
    needs: 'Needs you',
    threads: 'Threads',
    product: 'Product',
    activity: 'Activity',
    knowledge: 'Knowledge',
    sources: 'Sources',
    models: 'Models & providers',
    keys: 'Agent keys',
  },
  {
    needs: 'Te necesita',
    threads: 'Hilos',
    product: 'Producto',
    activity: 'Actividad',
    knowledge: 'Conocimiento',
    sources: 'Fuentes',
    models: 'Modelos y proveedores',
    keys: 'Claves de agente',
  },
);

export const COMMAND_MENU = messages(
  {
    title: 'Search and go to',
    searchLabel: 'Search decisions, features, ideas',
    placeholder: 'Search decisions, features, ideas — or go to a section',
    esc: 'Esc',
    results: 'Results',
    searchResults: 'Search results',
    searching: 'Searching…',
    noMatches: 'No matches',
    matches: (n: number) => `${n} ${n === 1 ? 'match' : 'matches'}`,
    noPageOfItsOwn: 'It has no page of its own.',
    goTo: 'Go to',
  },
  {
    title: 'Buscar e ir a',
    searchLabel: 'Buscar decisiones, funcionalidades, ideas',
    placeholder: 'Busca decisiones, funcionalidades, ideas — o ve a una sección',
    esc: 'Esc',
    results: 'Resultados',
    searchResults: 'Resultados de la búsqueda',
    searching: 'Buscando…',
    noMatches: 'Sin resultados',
    matches: (n: number) => `${n} ${n === 1 ? 'resultado' : 'resultados'}`,
    noPageOfItsOwn: 'No tiene una página propia.',
    goTo: 'Ir a',
  },
);

export const CONNECTION = messages(
  {
    live: 'Live',
    offline: 'Offline',
    reconnecting: 'Reconnecting…',
    connecting: 'Connecting…',
    liveUpdates: (word: string) => `Live updates: ${word}`,
    reload: 'Reload',
    retryNow: 'Retry now',
    cantReconnect: "Can't reconnect to DEMIURGO: live updates stopped. Reload the page to see them again.",
    paused: 'Live updates paused — reconnecting. What you see may be out of date; you can keep working.',
  },
  {
    live: 'En directo',
    offline: 'Sin conexión',
    reconnecting: 'Reconectando…',
    connecting: 'Conectando…',
    liveUpdates: (word: string) => `Actualizaciones en directo: ${word}`,
    reload: 'Recargar',
    retryNow: 'Reintentar ahora',
    cantReconnect:
      'No se puede reconectar con DEMIURGO: las actualizaciones en directo se detuvieron. Recarga la página para verlas de nuevo.',
    paused:
      'Actualizaciones en directo en pausa — reconectando. Lo que ves puede estar desactualizado; puedes seguir trabajando.',
  },
);

export const DEV_PANEL = messages(
  {
    deleting: 'Deleting…',
    restarting: 'Restarting the API…',
    restoreTitle: (label: string) => `Restore «${label}»?`,
    restoreBody: 'Everything done after it is lost. You stay signed in.',
    restore: 'Restore',
    dropTitle: (label: string) => `Delete the snapshot «${label}»?`,
    dropBody: 'The snapshot is gone for good.',
    drop: 'Delete',
    resetTitle: (db: string) => `Reset ${db}?`,
    resetBody: 'Every project is deleted. You stay signed in. Save a snapshot first if in doubt.',
    reset: 'Reset',
    snapshotsTitle: 'Snapshots',
    snapshotsDescription: (db: string) =>
      `Copies of the whole database (${db}): projects, conversations, runs and knowledge. Development only.`,
    label: 'Label',
    labelPlaceholder: 'after day 1',
    saveSnapshot: 'Save snapshot',
    loadingSnapshots: 'Loading the snapshots',
    noSnapshots: 'No snapshots yet.',
    resetLine: 'Reset: an empty database with the same people, ready for a new Day 1.',
    resetEllipsis: 'Reset…',
    confirm: 'Confirm',
  },
  {
    deleting: 'Eliminando…',
    restarting: 'Reiniciando la API…',
    restoreTitle: (label: string) => `¿Restaurar «${label}»?`,
    restoreBody: 'Se pierde todo lo hecho después. Sigues con la sesión iniciada.',
    restore: 'Restaurar',
    dropTitle: (label: string) => `¿Eliminar la instantánea «${label}»?`,
    dropBody: 'La instantánea desaparece para siempre.',
    drop: 'Eliminar',
    resetTitle: (db: string) => `¿Reiniciar ${db}?`,
    resetBody: 'Se elimina cada proyecto. Sigues con la sesión iniciada. Guarda antes una instantánea si tienes dudas.',
    reset: 'Reiniciar',
    snapshotsTitle: 'Instantáneas',
    snapshotsDescription: (db: string) =>
      `Copias de toda la base de datos (${db}): proyectos, conversaciones, ejecuciones y conocimiento. Solo para desarrollo.`,
    label: 'Etiqueta',
    labelPlaceholder: 'tras el día 1',
    saveSnapshot: 'Guardar instantánea',
    loadingSnapshots: 'Cargando las instantáneas',
    noSnapshots: 'Todavía no hay instantáneas.',
    resetLine: 'Reiniciar: una base de datos vacía con las mismas personas, lista para un nuevo día 1.',
    resetEllipsis: 'Reiniciar…',
    confirm: 'Confirmar',
  },
);

export const HELP = messages(
  {
    title: 'Help',
    description: 'What the symbols mean, and the keyboard.',
    symbols: 'Symbols',
    keyboard: 'Keyboard',
    howSure: 'How sure it is',
    whereItStands: 'Where it stands',
    setAside: 'Set aside',
    whoDidIt: 'Who did it',
    you: 'You',
    demiurgo: 'DEMIURGO',
    agent: 'Agent',
    automatic: 'Automatic',
    readyToBuild: 'Ready to build',
    readyToBuildBody:
      'A feature is ready to build when nothing blocks it. The track has three steps: ready, built and verified; today only the first one fills.',
    keyboardShortcuts: 'Keyboard shortcuts',
  },
  {
    title: 'Ayuda',
    description: 'Qué significan los símbolos, y el teclado.',
    symbols: 'Símbolos',
    keyboard: 'Teclado',
    howSure: 'Cuán seguro está',
    whereItStands: 'Dónde está',
    setAside: 'Aparcado',
    whoDidIt: 'Quién lo hizo',
    you: 'Tú',
    demiurgo: 'DEMIURGO',
    agent: 'Agente',
    automatic: 'Automático',
    readyToBuild: 'Listo para construir',
    readyToBuildBody:
      'Una funcionalidad está lista para construir cuando nada la bloquea. El recorrido tiene tres pasos: lista, construida y verificada; hoy solo se rellena el primero.',
    keyboardShortcuts: 'Atajos de teclado',
  },
);

export const HELP_KEYS = messages(
  {
    search: 'Search, or go to a section',
    openHelp: 'Open this help',
    closeLayer: 'Close a dialog, a menu or a panel',
    send: 'Send, in any box where you write to DEMIURGO',
    newLine: 'A new line in those boxes',
    askInThread: 'Ask DEMIURGO, in a thread',
    moveList: 'Move through a list, a menu or search results',
    moveTabs: 'Move through tabs and choices; resize a side panel',
  },
  {
    search: 'Buscar, o ir a una sección',
    openHelp: 'Abrir esta ayuda',
    closeLayer: 'Cerrar un diálogo, un menú o un panel',
    send: 'Enviar, en cualquier caja donde le escribes a DEMIURGO',
    newLine: 'Una nueva línea en esas cajas',
    askInThread: 'Preguntar a DEMIURGO, en un hilo',
    moveList: 'Moverse por una lista, un menú o resultados de búsqueda',
    moveTabs: 'Moverse por pestañas y opciones; cambiar el ancho de un panel lateral',
  },
);

export const PERSON_MENU = messages(
  {
    yourMenu: 'Your menu',
    signedInAs: (person: string) => `Signed in as ${person}`,
    theme: 'Theme',
    likeTheSystem: 'Like the system',
    light: 'Light',
    dark: 'Dark',
    language: 'Language',
    likeTheBrowser: 'Like the browser',
    snapshots: 'Snapshots…',
    signOut: 'Sign out',
  },
  {
    yourMenu: 'Tu menú',
    signedInAs: (person: string) => `Sesión iniciada como ${person}`,
    theme: 'Tema',
    likeTheSystem: 'Como el sistema',
    light: 'Claro',
    dark: 'Oscuro',
    language: 'Idioma',
    likeTheBrowser: 'Como el navegador',
    snapshots: 'Instantáneas…',
    signOut: 'Cerrar sesión',
  },
);

export const PRODUCT_TABS = messages(
  { productViews: 'Product views', overview: 'Overview', map: 'Map', journeys: 'Journeys', origins: 'Origins' },
  { productViews: 'Vistas del producto', overview: 'Resumen', map: 'Mapa', journeys: 'Recorridos', origins: 'Orígenes' },
);

export const PROJECT_SHELL = messages(
  {
    openSections: 'Open the sections',
    sections: 'Sections',
    search: 'Search (Ctrl K)',
    needsYou: (n: number) => `${n} ${n === 1 ? 'thing needs' : 'things need'} you`,
  },
  {
    openSections: 'Abrir las secciones',
    sections: 'Secciones',
    search: 'Buscar (Ctrl K)',
    needsYou: (n: number) => `${n} ${n === 1 ? 'cosa te necesita' : 'cosas te necesitan'}`,
  },
);

export const PROJECT_SWITCHER = messages(
  {
    projects: 'Projects',
    switchTo: 'Switch to',
    allProjects: 'All projects',
    newProject: 'New project',
    renameProject: 'Rename the project…',
    renameTitle: 'Rename the project',
    name: 'Name',
    rename: 'Rename',
    ariaLabel: (name: string) => `Project: ${name}. Switch or manage projects`,
    renamed: (name: string) => `The project is now called ${name}.`,
  },
  {
    projects: 'Proyectos',
    switchTo: 'Cambiar a',
    allProjects: 'Todos los proyectos',
    newProject: 'Nuevo proyecto',
    renameProject: 'Renombrar el proyecto…',
    renameTitle: 'Renombrar el proyecto',
    name: 'Nombre',
    rename: 'Renombrar',
    ariaLabel: (name: string) => `Proyecto: ${name}. Cambiar o gestionar proyectos`,
    renamed: (name: string) => `El proyecto ahora se llama ${name}.`,
  },
);

export const SIDEBAR = messages(
  {
    sections: 'Sections',
    home: 'DEMIURGO: your projects',
    search: 'Search',
    ctrlK: 'Ctrl K',
    expand: 'Expand the sidebar',
    collapse: 'Collapse the sidebar',
    devTools: 'Dev tools: snapshots',
    help: 'Help (?)',
    helpLabel: 'Help',
    knowledgeGroup: 'Knowledge',
    settingsGroup: 'Settings',
    needsYouIndicator: (n: number) => `${n} ${n === 1 ? 'thing needs' : 'things need'} you`,
    nothingWaits: 'Nothing waits for you',
    thingsWait: (n: number) => `${n} ${n === 1 ? 'thing waits' : 'things wait'} for you`,
    working: (n: number) => `${n} working`,
    stalledOrLate: (n: number) => `${n} stalled or late`,
    failed: (n: number) => `${n} failed`,
    nothingRunning: 'Nothing running',
    behind: (n: number) => `Behind: ${n} ${n === 1 ? 'update' : 'updates'} failed`,
    updating: (n: number) => `Updating: ${n} ${n === 1 ? 'change' : 'changes'} to go`,
    upToDate: (v: number) => `Up to date (version ${v})`,
  },
  {
    sections: 'Secciones',
    home: 'DEMIURGO: tus proyectos',
    search: 'Buscar',
    ctrlK: 'Ctrl K',
    expand: 'Ampliar la barra lateral',
    collapse: 'Plegar la barra lateral',
    devTools: 'Herramientas de desarrollo: instantáneas',
    help: 'Ayuda (?)',
    helpLabel: 'Ayuda',
    knowledgeGroup: 'Conocimiento',
    settingsGroup: 'Ajustes',
    needsYouIndicator: (n: number) => `${n} ${n === 1 ? 'cosa te necesita' : 'cosas te necesitan'}`,
    nothingWaits: 'Nada te espera',
    thingsWait: (n: number) => `${n} ${n === 1 ? 'cosa te espera' : 'cosas te esperan'}`,
    working: (n: number) => `${n} en curso`,
    stalledOrLate: (n: number) => `${n} estancadas o tarde`,
    failed: (n: number) => `${n} fallidas`,
    nothingRunning: 'Nada en curso',
    behind: (n: number) => `Atrasado: ${n} ${n === 1 ? 'actualización fallida' : 'actualizaciones fallidas'}`,
    updating: (n: number) => `Actualizando: ${n} ${n === 1 ? 'cambio' : 'cambios'} por hacer`,
    upToDate: (v: number) => `Al día (versión ${v})`,
  },
);

export const WORKSPACE_FRAME = messages(
  {
    workspace: 'Workspace',
    yourProjects: 'Your projects',
    newProject: 'New project',
    models: 'Models & providers',
    help: 'Help (?)',
  },
  {
    workspace: 'Espacio de trabajo',
    yourProjects: 'Tus proyectos',
    newProject: 'Nuevo proyecto',
    models: 'Modelos y proveedores',
    help: 'Ayuda (?)',
  },
);
