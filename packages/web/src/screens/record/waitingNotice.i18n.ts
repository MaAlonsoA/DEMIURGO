import { messages } from '../../i18n/define.ts';

export const WAITING_NOTICE = messages(
  {
    title: 'Plan the tasks of this feature next',
    body: (n: number) =>
      `${n} ${n === 1 ? 'item waits' : 'items wait'} for this feature and it has no task plan yet: plan its tasks next.`,
  },
  {
    title: 'Planifica a continuación las tareas de esta funcionalidad',
    body: (n: number) =>
      `${n} ${n === 1 ? 'elemento espera' : 'elementos esperan'} a esta funcionalidad y todavía no tiene plan de tareas: planifica sus tareas a continuación.`,
  },
);
