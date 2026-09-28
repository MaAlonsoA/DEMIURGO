# Compatibilidad secundaria con registros en español

Dos escenarios de desarrollo y sus dos variantes con registros históricos en español.
Los cambios, ideas y nodos focales están traducidos; las reglas administrativas restantes
siguen en inglés, como puede ocurrir en un proyecto que conserva registros antiguos.
Las variantes conservan proyecto, familia y partición. No son cuatro observaciones independientes.

No hay etiquetas adjudicadas. `proposals.json` conserva las propuestas de IA del original, con citas de la variante; tampoco son decisiones humanas. Prepare fichas con:

```sh
pnpm benchmark:knowledge cards --dataset evals/knowledge/v2-legacy-es \
  --output reports/knowledge/legacy-es-review
```

Adjudique sin consultar los juicios del original. Después use `reveal` con este `--dataset` para
comparar su juicio con la propuesta de IA.
No mezcle estos resultados con el piloto principal ni con la futura confirmación.
