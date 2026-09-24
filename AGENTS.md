# DEMIURGO: intención de producto

DEMIURGO sirve para diseñar su propio MVP dentro de la aplicación antes de reimplementarlo con una arquitectura limpia. En esta etapa deben funcionar y poder crearse artefactos hasta Diseño; Implementación y Revisión quedan como fases del ciclo, aún sin ejecutar desde esta interfaz.

Jerarquía: **Proyecto → Exploraciones → Decisiones → Diseños (ADR y FDR) → Implementación → Revisión**. Un proyecto es el contenedor del producto; una exploración es un proceso concreto con conversación, preguntas y conclusiones. Las decisiones pertenecen a una exploración. Los diseños pertenecen a una exploración y se justifican en una decisión. No presentar el proyecto como si fuera una exploración.

El ciclo puede volver a Exploración desde cualquiera de sus fases, incluso desde una respuesta a una pregunta. Cada nueva línea conserva su origen y requiere aceptación humana cuando la propone el agente. No convertir hipótesis en decisiones aprobadas automáticamente.

Trabajar solo con la instancia estable, publicada en `127.0.0.1:8000`.
