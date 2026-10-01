// Words of the deterministic impact («suspect links»): what rests on something that changed.

import { messages } from '../../i18n/define.ts';

export const SUSPECT = messages(
  {
    basedOn: (from: number, to: number) => `Based on v${from} · now v${to}`,
    review: 'Review',
    noticeTitle: (upstream: string, from: number, to: number) => `${upstream} changed (v${from} to v${to}) since this was written`,
    noticeBody: 'Check it against the change: ask for a review in a thread, or say it still holds as it is.',
    reviewInThread: 'Review in a thread',
    stillValid: 'Still valid',
    stillValidHint: 'It still holds against the new version. Nothing in it changes.',
    working: 'Working…',
    confirmedStillValid: 'Marked as still valid.',
    purpose: (code: string, n: number, upstream: string, from: number, to: number) =>
      `Review ${code} v${n}: ${upstream} changed from v${from} to v${to}`,
  },
  {
    basedOn: (from: number, to: number) => `Basada en la v${from} · ahora la v${to}`,
    review: 'Revisar',
    noticeTitle: (upstream: string, from: number, to: number) => `${upstream} cambió (v${from} a v${to}) desde que se escribió esto`,
    noticeBody: 'Compruébalo contra el cambio: pide una revisión en un hilo, o di que sigue valiendo tal cual.',
    reviewInThread: 'Revisar en un hilo',
    stillValid: 'Sigue vigente',
    stillValidHint: 'Sigue valiendo con la versión nueva. No cambia nada de su contenido.',
    working: 'Un momento…',
    confirmedStillValid: 'Marcada como vigente.',
    purpose: (code: string, n: number, upstream: string, from: number, to: number) =>
      `Review ${code} v${n}: ${upstream} changed from v${from} to v${to}`,
  },
);
