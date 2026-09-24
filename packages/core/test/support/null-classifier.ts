import type { Classifier } from '@demiurgo/domain';

export const classifierNotConfigured: Classifier = {
  id: 'not-configured@0',
  choice: () => Promise.reject(new Error('Classifier not configured in this test.')),
  score: () => Promise.reject(new Error('Classifier not configured in this test.')),
  noul: () => Promise.reject(new Error('Classifier not configured in this test.')),
};
