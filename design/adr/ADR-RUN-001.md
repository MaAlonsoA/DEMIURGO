---
codigo: ADR-RUN-001
tipo: adr
titulo: Runner aislado y frontera de las acciones de IA
version: 1
estado: propuesto
dominio: plataforma
incremento: S0
enlaces:
  - tipo: based_on
    destino: DEC-PLN-001@1
anexos: []
---

# ADR-RUN-001 · Runner aislado y frontera de las acciones de IA

## Contexto

En la v1, el backend corría como root con los datos y la autenticación de Codex montados, y los agentes se lanzaban desde ese mismo proceso. El principio 6 del plan exige lo contrario: las reglas que juzgan no viven en lo que se juzga, y el runner no tiene datos, credenciales, root ni red (I9).

La máquina es Windows 11 con Docker Desktop. Las acciones de IA del Pilar 1 procesan fuentes importadas, que son entrada no confiable. Los agentes están autenticados por suscripción en el host (ADR-AGE-001).

Dominios de confianza (§6 del stack):

- **T0:** orquestador, base de datos, credenciales y broker.
- **T1:** todo lo que escribió o ejecuta un agente, incluidos los gates sobre su código.

## Opciones

- **Broker propio sobre la CLI `docker`, con contenedores endurecidos.** No añade dependencias npm al único componente con acceso a Docker.
- **Broker con dockerode.** Mete un árbol npm sin auditar en el componente que equivale a root en la VM de Docker.
- **Docker Sandboxes (`sbx`).** MicroVM con credenciales enmascaradas, pero propietario y 0.x, con cambios incompatibles casi cada semana. Queda para un spike posterior detrás del mismo contrato.
- **Subproceso restringido en el host.** Sin aislamiento de red ni de ficheros en Windows.
- **Broker en Go.** Opción si el de Node da problemas: el contrato `JobSpec` permite reescribirlo sin tocar nada más.

## Decisión

Runner:

- El broker es el único componente que habla con Docker, a través de la CLI `docker`.
- Solo acepta un `JobSpec` cerrado: imagen por digest de una lista permitida, comando, límites y tiempo máximo. Rechaza montajes arbitrarios y opciones no declaradas.
- Cada trabajo corre en un contenedor efímero: usuario no root, `--cap-drop ALL`, `no-new-privileges`, raíz de solo lectura, `tmpfs` para escribir, `--network none` y límites de CPU, memoria y PIDs.
- El tiempo máximo lo impone el broker: al vencer, hace `docker kill` y el trabajo termina con `failure_kind` `timeout`.
- Una sonda dentro del runner comprueba que no hay credenciales, ficheros de datos, acceso a la base ni red, y que no es root.

Acciones de IA del Pilar 1 (S1–S2):

- Usan `claude -p` en el host, porque necesita la suscripción autenticada.
- Se ejecutan en un directorio temporal vacío, sin herramientas (`--tools ""`), sin MCP (`--strict-mcp-config`), sin ajustes del proyecto y sin sesión persistente.
- El entorno se filtra: sin `DEMIURGO_*`, `DATABASE_URL`, `PG*` ni `ANTHROPIC_API_KEY`.
- Solo devuelven una salida estructurada. El sistema la valida con el esquema común y la convierte en propuestas: nunca escriben en el dominio.

Limitación conocida: con Docker Desktop, T0 y T1 comparten la VM de Docker. Un escape de contenedor alcanzaría la base aunque no esté montada. Se mitiga con el endurecimiento; la separación real (microVM o una VM Hyper-V dedicada) llega después del esqueleto. Las acciones de IA del Pilar 1 corren fuera del contenedor: su frontera es el directorio vacío, la falta de herramientas y el entorno filtrado.

## Consecuencias

- Ningún proceso con credenciales de la base o del modelo corre en T1.
- Un gate o un agente no pueden leer los datos, la base ni las credenciales.
- Una inyección en una fuente importada no puede escribir ni ejecutar nada: lo peor que produce es una propuesta que la persona rechaza.
- Quedan pendientes el proxy de egress y la pasarela de modelo para el implementador (S4), y la separación por microVM.

## Spike

Ejecución real del 24-09-2026 (informe completo en `docs/ejecuciones-reales/sonda-runner-2026-09-24.md`). La sonda corrió en el runner con la imagen `node:24.21-alpine` fijada por digest, mientras el proceso del host tenía variables de credenciales falsas y el Postgres de desarrollo escuchaba en `127.0.0.1:55432`.

| Comprobación | Resultado |
|---|---|
| Usuario y privilegios | uid 1000, `CapEff` 0, `NoNewPrivs` 1, seccomp activo |
| Variables sensibles | Ninguna: las del host no llegan al contenedor |
| Ficheros de datos y credenciales | No existen o no son accesibles |
| Base de datos y red | Todas las conexiones fallan: sin DNS, sin rutas y sin Internet |
| Escritura | Solo en `/tmp` (tmpfs `noexec`); el resto es de solo lectura |

Tiempos: la sonda tarda unos 5,4 s (3 s los marca el intento de DNS) y un trabajo trivial unos 0,4 s. Un trabajo que excede su tiempo se mata en unos 3,2 s y la cancelación en unos 2,2 s.

Control sin el runner: un `docker run` por defecto corre como root, se conecta al Postgres del host por `host.docker.internal` y sale a Internet. La barrera decisiva es `--network none`.

Hallazgo: el backend de Docker Desktop en esta máquina es **WSL2**, no Hyper-V como recomienda el §6 del stack. T0 y T1 comparten la VM, y esa VM es la misma de las distros WSL de la persona. Queda como decisión pendiente pasar a Hyper-V o a una microVM para el runner antes de S4.

Alcance reducido (desviación): la sonda comprueba el aislamiento del runner, pero no es el spike que pide el plan (§6, etapa 1). Falta que un agente en un contenedor modifique un repo de ejemplo y que el runner, sin datos ni credenciales, ejecute sus pruebas. Hacerlo o aceptar la desviación queda como decisión pendiente antes de S4.

## Criterios de aceptación

### AC-RUN-001-01 · Contenedor endurecido

- Verificación: automática
- Comprobación: Se revisa la orden con la que el broker lanza el contenedor.

Dado un `JobSpec` válido, cuando el runner lanza el contenedor, entonces lo hace con usuario no root, `--cap-drop ALL`, `no-new-privileges`, raíz de solo lectura, sin red y con límites de CPU, memoria y PIDs.

### AC-RUN-001-02 · Tiempo máximo

- Verificación: automática
- Comprobación: Se lanza un trabajo que dura más que su tiempo máximo.

Dado un trabajo que excede su tiempo máximo, cuando vence el plazo, entonces el runner mata el contenedor y el trabajo termina con `failure_kind` `timeout`.

### AC-RUN-001-03 · Frontera de las acciones de IA

- Verificación: automática
- Comprobación: Se revisan el directorio, los argumentos y el entorno con los que el adaptador lanza la CLI.

Dada una acción de IA del Pilar 1, cuando el adaptador lanza la CLI, entonces lo hace en un directorio temporal vacío, sin herramientas ni MCP y sin las variables `DEMIURGO_*`, `DATABASE_URL`, `PG*` ni `ANTHROPIC_API_KEY`.

### AC-RUN-001-04 · Aceptación humana

- Verificación: manual
- Comprobación: La persona revisa el ADR con el resultado de la sonda y lo fusiona en `main`.

Dado este ADR en estado propuesto, cuando la persona lo revisa, entonces lo acepta con el merge.
