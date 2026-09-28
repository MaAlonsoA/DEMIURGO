# Conjunto de evaluación del clasificador (v1-en)

> **Pendiente de revisión.** Esta traducción la hizo un agente el 2026-09-28 y ninguna persona la ha revisado todavía. No hay que fiarse de sus resultados (ni sacar conclusiones de la ablación español frente a inglés) hasta que la persona la revise y lo haga constar aquí.

## Qué es

Es la traducción al inglés de [`v1`](../v1/README.md): los mismos casos, en el mismo orden, con los mismos `id`, `partition`, `expected`, `labels`, `ref` y `type`. Solo cambian los campos de prosa: el `title` y el `text` de cada nodo, el `text` de las ideas y la `note`.

Sirve para dos cosas:

- **La ablación español frente a inglés:** medir el mismo clasificador sobre `v1` y `v1-en` y comparar, caso por caso, porque las etiquetas son idénticas.
- **Evaluar clasificadores que trabajan en inglés,** como Jev.

Las reglas de las clases, el formato, las particiones y los límites son los de `v1`: su README es la referencia. En particular:

- Cada `ref@version` tiene el mismo título y texto en todos los casos de los dos ficheros.
- Las instrucciones inyectadas (etiqueta `injection`) se han traducido también, con la misma intención.
- En los casos `shared_words` y `synonyms` se ha buscado conservar la palabra compartida o el sinónimo en inglés («number», «threshold», «channel», «assembly», «reserve»; «queue» frente a «waiting list», «a couple of companions» frente a «two guests», «half» frente a «50%»).
- Los importes y decimales siguen la convención inglesa (`€45`, `0.8`).

| Fichero | Casos |
|---|---|
| `verdicts.jsonl` | 69 |
| `ideas.jsonl` | 45 |

## Qué revisar

Al revisarlo, conviene mirar sobre todo que la etiqueta `expected` siga siendo la correcta para el texto inglés en los casos frontera (`keep` frente a `relate`, `update` frente a `invalidate` o `add`, `conflicts` frente a `inconsistent`) y en los de etiqueta `shared_words`, `synonyms` y `negation`, donde un matiz de la traducción puede facilitar o dificultar el caso. Si se corrige algo, se deja constancia aquí y se registra la nueva huella del fichero.

## Cómo se usa

```bash
node packages/api/src/cli.ts evaluate-classifier <provider> <model> [effort|-] [test|dev|all] v1-en
```

Como con `v1`, la evaluación con Claude o Codex consume cuota, y el resultado se guarda en `evals/classifier/results/` con la huella sha256 del fichero, que distingue las mediciones de `v1` y de `v1-en`.
