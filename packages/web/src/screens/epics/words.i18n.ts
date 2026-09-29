import { messages } from '../../i18n/define.ts';

export const EPICS = messages(
  {
    title: 'Epics',
    meta: (epics: number, features: number) =>
      `${epics} ${epics === 1 ? 'epic' : 'epics'} · ${features} ${features === 1 ? 'feature' : 'features'} in them`,
    loading: 'Loading epics',
    noneYet: 'No epics yet',
    noneHint:
      'An epic is a capability of the first version too big for one feature. When the product definition is done, DEMIURGO proposes some from the Product page.',
    goToProduct: 'Go to Product',
    open: 'Open the epic',
    features: 'Features',
    noFeatures: 'No features yet. Open the epic and ask DEMIURGO about it to split it into features.',
  },
  {
    title: 'Épicas',
    meta: (epics: number, features: number) =>
      `${epics} ${epics === 1 ? 'épica' : 'épicas'} · ${features} ${features === 1 ? 'funcionalidad' : 'funcionalidades'} en ellas`,
    loading: 'Cargando épicas',
    noneYet: 'Aún no hay épicas',
    noneHint:
      'Una épica es una capacidad de la primera versión demasiado grande para una sola funcionalidad. Cuando la definición del producto está hecha, DEMIURGO propone algunas desde la página de Producto.',
    goToProduct: 'Ir a Producto',
    open: 'Abrir la épica',
    features: 'Funcionalidades',
    noFeatures: 'Aún no tiene funcionalidades. Abre la épica y pregunta a DEMIURGO sobre ella para trocearla.',
  },
);
