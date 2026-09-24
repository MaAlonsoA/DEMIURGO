import type { Classifier } from '@demiurgo/domain';

export const classifierNotConfigured: Classifier = {
  id: 'no-configurado@0',
  choice: () => Promise.reject(new Error('Clasificador no configurado en esta prueba.')),
  score: () => Promise.reject(new Error('Clasificador no configurado en esta prueba.')),
  noul: () => Promise.reject(new Error('Clasificador no configurado en esta prueba.')),
};
