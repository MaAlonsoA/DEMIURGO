# Piloto del motor de conocimiento

40 escenarios originales en inglés, 20 familias: 24 escenarios de desarrollo y 16 de validación.
Son propuestas de IA, **no referencia adjudicada**. Ninguno servirá como test confirmatorio.

El [protocolo](../../../docs/benchmark-conocimiento-jev.md) explica los comandos, las rúbricas,
la revisión ciega, los denominadores y las limitaciones. Las definiciones inglesas están en
[rubrics.json](rubrics.json); las etiquetas sugeridas están separadas en `proposals.json`.
Primero revise las fichas; consulte las propuestas solamente después de guardar su juicio.

| Ficha ciega | Familia | Partición | Dificultad principal |
| --- | --- | --- | --- |
| [F01-1](cards/F01-1.md) | F01 | dev | extension |
| [F01-2](cards/F01-2.md) | F01 | dev | extension |
| [F02-1](cards/F02-1.md) | F02 | dev | replacement |
| [F02-2](cards/F02-2.md) | F02 | dev | replacement |
| [F03-1](cards/F03-1.md) | F03 | dev | revision |
| [F03-2](cards/F03-2.md) | F03 | dev | revision |
| [F04-1](cards/F04-1.md) | F04 | dev | relation |
| [F04-2](cards/F04-2.md) | F04 | dev | relation |
| [F05-1](cards/F05-1.md) | F05 | dev | unrelated |
| [F05-2](cards/F05-2.md) | F05 | dev | unrelated |
| [F06-1](cards/F06-1.md) | F06 | dev | negation |
| [F06-2](cards/F06-2.md) | F06 | dev | negation |
| [F07-1](cards/F07-1.md) | F07 | dev | exception |
| [F07-2](cards/F07-2.md) | F07 | dev | exception |
| [F08-1](cards/F08-1.md) | F08 | dev | assumption |
| [F08-2](cards/F08-2.md) | F08 | dev | assumption |
| [F09-1](cards/F09-1.md) | F09 | dev | insufficient_context |
| [F09-2](cards/F09-2.md) | F09 | dev | insufficient_context |
| [F10-1](cards/F10-1.md) | F10 | dev | injection |
| [F10-2](cards/F10-2.md) | F10 | dev | injection |
| [F11-1](cards/F11-1.md) | F11 | dev | excluded_criterion |
| [F11-2](cards/F11-2.md) | F11 | dev | excluded_criterion |
| [F12-1](cards/F12-1.md) | F12 | dev | truncated_evidence |
| [F12-2](cards/F12-2.md) | F12 | dev | truncated_evidence |
| [F13-1](cards/F13-1.md) | F13 | validation | external_source |
| [F13-2](cards/F13-2.md) | F13 | validation | external_source |
| [F14-1](cards/F14-1.md) | F14 | validation | scope_extension |
| [F14-2](cards/F14-2.md) | F14 | validation | scope_extension |
| [F15-1](cards/F15-1.md) | F15 | validation | authority |
| [F15-2](cards/F15-2.md) | F15 | validation | authority |
| [F16-1](cards/F16-1.md) | F16 | validation | equivalence |
| [F16-2](cards/F16-2.md) | F16 | validation | equivalence |
| [F17-1](cards/F17-1.md) | F17 | validation | lexical_miss |
| [F17-2](cards/F17-2.md) | F17 | validation | lexical_miss |
| [F18-1](cards/F18-1.md) | F18 | validation | version_precedence |
| [F18-2](cards/F18-2.md) | F18 | validation | version_precedence |
| [F19-1](cards/F19-1.md) | F19 | validation | candidate_limit |
| [F19-2](cards/F19-2.md) | F19 | validation | candidate_limit |
| [F20-1](cards/F20-1.md) | F20 | validation | temporal_scope |
| [F20-2](cards/F20-2.md) | F20 | validation | temporal_scope |
