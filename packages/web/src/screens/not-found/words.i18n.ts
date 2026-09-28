// Words of the Not found screen.

import { messages } from '../../i18n/define.ts';

export const NOT_FOUND = messages(
  {
    title: 'Not found',
    thing: 'this page',
    couldNotFind: (thing: string) => `We couldn't find ${thing}.`,
    backToProduct: 'Back to the product',
    backToDemiurgo: 'Back to DEMIURGO',
  },
  {
    title: 'No encontrado',
    thing: 'esta página',
    couldNotFind: (thing: string) => `No hemos encontrado ${thing}.`,
    backToProduct: 'Volver al producto',
    backToDemiurgo: 'Volver a DEMIURGO',
  },
);
