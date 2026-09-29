// Interface words of the New record screen. The pure helper form.ts (recordMissing, its
// error/hint strings) is unit-tested with fixed English output and is not translated here.

import { messages } from '../../i18n/define.ts';
import type { RecordType } from './form.ts';

export const NEW_RECORD = messages(
  {
    newRecord: 'New record',
    writeItYourself: 'Write it yourself. DEMIURGO is not asked anything.',
    whatItIs: 'What it is',
    keptFromPreviousType: 'Kept from the previous type',
    keptBody: 'This type has no section for what you wrote here. It is kept, and comes back if you choose that type again.',
    content: 'Content',
    title: 'Title',
    area: 'Area',
    areaHint: 'Lowercase letters and underscores. It names the code: «club» gives DEC-CLU-001.',
    areaError: (hint: string) => `Lowercase letters and underscores only, like ${hint}.`,
    checks: 'Checks',
    checksNoteRequired: (type: string) => `A ${type.toLowerCase()} needs at least one: how you'll know it holds.`,
    checksNoteOptional: 'How you will know it holds.',
    addACheck: 'Add a check',
    thisNewRecord: 'This new record',
    draft: 'Draft',
    versionOneAsDraft: 'Version 1 is saved as a draft. Nothing is decided until you approve it.',
    summary: (type: string, checks: number, links: number) =>
      `${type}, version 1 as a draft${checks > 0 ? ` · ${checks} ${checks === 1 ? 'check' : 'checks'}` : ''}${
        links > 0 ? ` · ${links} ${links === 1 ? 'link' : 'links'}` : ''
      }`,
    savedAnnounce: (code: string, version: number) => `Saved: ${code} v${version} is a draft.`,
    product: 'Product',
    hint: (type: RecordType): string =>
      (
        ({
          decision: 'Something decided about the product: what, and what follows from it.',
          epic: 'An epic: a capability too big for one feature, with its goal, its features in order and when it is done.',
          fdr: 'A feature: what it is for, what it covers and how it behaves, with the checks that prove it.',
          task: 'A task of a feature: a piece of its construction, small enough to build and check on its own, with its own checks.',
          adr: 'A technical choice: the options weighed, the one taken and its consequences, with its checks.',
          bug: 'Something that does not work: how to reproduce it, what was expected and what happened.',
          requirement:
            'A requirement in EARS form ("When <trigger>, the system shall <response>"), with the measurable criterion that shows it is met.',
          quality_requirement: 'A quality target (performance, availability, usability…) as a scenario with its measure.',
          threat_model: 'What is protected, from whom, the STRIDE threats and the mitigation for each one.',
          production_readiness: 'How it rolls out and back, how it is monitored, how it fails and scales, and who supports it.',
          product_definition:
            'What the product is, what it builds first and how: composed from the answers of the product definition stage.',
        }) as Record<RecordType, string>
      )[type],
  },
  {
    newRecord: 'Registro nuevo',
    writeItYourself: 'Escríbelo tú. No se le pide nada a DEMIURGO.',
    whatItIs: 'Qué es',
    keptFromPreviousType: 'Guardado del tipo anterior',
    keptBody: 'Este tipo no tiene una sección para lo que escribiste aquí. Se guarda, y vuelve si eliges ese tipo otra vez.',
    content: 'Contenido',
    title: 'Título',
    area: 'Área',
    areaHint: 'Minúsculas y guiones bajos. Da nombre al código: «club» da DEC-CLU-001.',
    areaError: (hint: string) => `Solo minúsculas y guiones bajos, como ${hint}.`,
    checks: 'Comprobaciones',
    checksNoteRequired: (type: string) => `${type} necesita al menos una: cómo sabrás que se cumple.`,
    checksNoteOptional: 'Cómo sabrás que se cumple.',
    // `type` ya llega en minúsculas y en español (p. ej. «funcionalidad»); no se antepone artículo
    // porque el género varía según el tipo de registro.
    addACheck: 'Añadir una comprobación',
    thisNewRecord: 'Este registro nuevo',
    draft: 'Borrador',
    versionOneAsDraft: 'La versión 1 se guarda como borrador. Nada se decide hasta que lo apruebes.',
    summary: (type: string, checks: number, links: number) =>
      `${type}, versión 1 como borrador${checks > 0 ? ` · ${checks} ${checks === 1 ? 'comprobación' : 'comprobaciones'}` : ''}${
        links > 0 ? ` · ${links} ${links === 1 ? 'enlace' : 'enlaces'}` : ''
      }`,
    savedAnnounce: (code: string, version: number) => `Guardado: ${code} v${version} es un borrador.`,
    product: 'Producto',
    hint: (type: RecordType): string =>
      (
        ({
          decision: 'Algo decidido sobre el producto: qué, y qué se sigue de ello.',
          epic: 'Una épica: una capacidad demasiado grande para una sola funcionalidad, con su objetivo, sus funcionalidades en orden y cuándo está hecha.',
          fdr: 'Una funcionalidad: para qué sirve, qué cubre y cómo se comporta, con las comprobaciones que lo demuestran.',
          task: 'Una tarea de una funcionalidad: un trozo de su construcción, lo bastante pequeño para hacerlo y comprobarlo por sí solo, con sus propias comprobaciones.',
          adr: 'Una elección técnica: las opciones sopesadas, la elegida y sus consecuencias, con sus comprobaciones.',
          bug: 'Algo que no funciona: cómo reproducirlo, qué se esperaba y qué pasó.',
          requirement:
            'Un requisito en forma EARS ("Cuando <disparador>, el sistema deberá <respuesta>"), con el criterio medible que demuestra que se cumple.',
          quality_requirement: 'Un objetivo de calidad (rendimiento, disponibilidad, usabilidad…) como escenario con su medida.',
          threat_model: 'Qué se protege, de quién, las amenazas STRIDE y la mitigación de cada una.',
          production_readiness: 'Cómo se despliega y se revierte, cómo se vigila, cómo falla y escala, y quién lo soporta.',
          product_definition:
            'Qué es el producto, qué construye primero y cómo: se compone con las respuestas de la etapa de definición.',
        }) as Record<RecordType, string>
      )[type],
  },
);
