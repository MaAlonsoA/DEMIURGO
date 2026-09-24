// Generado por `node packages/design/src/cli.ts derivar` desde design/datos/. No lo edites a mano.

export const CAPACIDADES = {
  "codigo": "DAT-CAP-001",
  "version": 1,
  "estado": "propuesto",
  "actores": {
    "human": "Persona con sesión (cookie httpOnly). Actor human:<persona>.",
    "agent_external": "Agente externo con token. Actor agent:<nombre>:<sesión>.",
    "agent_run": "Ejecución de un agente lanzada por DEMIURGO. Actor agent:run:<id>.",
    "system": "Componente del sistema. Actor system:<componente>@<versión>."
  },
  "comandos": {
    "project.create": {
      "entidad": "project",
      "permitido": [
        "human",
        "system"
      ],
      "decisivo": false,
      "descripcion": "Crear un proyecto."
    },
    "project.archive": {
      "entidad": "project",
      "permitido": [
        "human"
      ],
      "decisivo": false,
      "descripcion": "Archivar un proyecto en lugar de borrarlo."
    },
    "agent_token.issue": {
      "entidad": "agent_token",
      "permitido": [
        "human"
      ],
      "decisivo": false,
      "descripcion": "Emitir un token para un agente externo con su nombre."
    },
    "agent_token.revoke": {
      "entidad": "agent_token",
      "permitido": [
        "human"
      ],
      "decisivo": false,
      "descripcion": "Revocar el token de un agente externo."
    },
    "exploration.open": {
      "entidad": "exploration",
      "permitido": [
        "human"
      ],
      "decisivo": false,
      "descripcion": "Abrir una exploración con su propósito y su origen."
    },
    "exploration.conclude": {
      "entidad": "exploration",
      "permitido": [
        "human"
      ],
      "decisivo": false,
      "descripcion": "Dar por concluida una exploración."
    },
    "exploration.set_aside": {
      "entidad": "exploration",
      "permitido": [
        "human"
      ],
      "decisivo": false,
      "descripcion": "Apartar una exploración con un motivo."
    },
    "exploration.resume": {
      "entidad": "exploration",
      "permitido": [
        "human"
      ],
      "decisivo": false,
      "descripcion": "Retomar una exploración concluida o apartada."
    },
    "message.post": {
      "entidad": "message",
      "permitido": [
        "human",
        "agent_external",
        "agent_run"
      ],
      "decisivo": false,
      "descripcion": "Publicar un mensaje en un hilo con el actor como autor."
    },
    "source.register": {
      "entidad": "source",
      "permitido": [
        "human",
        "agent_external"
      ],
      "decisivo": false,
      "descripcion": "Registrar una fuente como entrada no confiable."
    },
    "question.raise": {
      "entidad": "question",
      "permitido": [
        "human",
        "agent_run",
        "system"
      ],
      "decisivo": false,
      "descripcion": "Plantear una pregunta en una exploración."
    },
    "question.infer": {
      "entidad": "question",
      "permitido": [
        "system"
      ],
      "decisivo": false,
      "descripcion": "Marcar una pregunta como inferida a partir de la salida de un agente."
    },
    "question.confirm": {
      "entidad": "question",
      "permitido": [
        "human"
      ],
      "decisivo": true,
      "descripcion": "Confirmar una pregunta con su conclusión."
    },
    "question.postpone": {
      "entidad": "question",
      "permitido": [
        "human"
      ],
      "decisivo": false,
      "descripcion": "Posponer una pregunta con un motivo."
    },
    "question.discard": {
      "entidad": "question",
      "permitido": [
        "human"
      ],
      "decisivo": false,
      "descripcion": "Descartar una pregunta con un motivo."
    },
    "question.reopen": {
      "entidad": "question",
      "permitido": [
        "human"
      ],
      "decisivo": false,
      "descripcion": "Reabrir una pregunta conservando su historial."
    },
    "record.create": {
      "entidad": "record",
      "permitido": [
        "human"
      ],
      "decisivo": false,
      "descripcion": "Crear un registro (decisión, FDR, ADR o bug) con su versión 1 en borrador."
    },
    "record_version.create": {
      "entidad": "record_version",
      "permitido": [
        "human"
      ],
      "decisivo": false,
      "descripcion": "Crear una versión nueva con arrastre explícito de sus criterios."
    },
    "record_version.approve": {
      "entidad": "record_version",
      "permitido": [
        "human"
      ],
      "decisivo": true,
      "descripcion": "Aprobar una versión sin crear otra."
    },
    "record_version.supersede": {
      "entidad": "record_version",
      "permitido": [
        "system"
      ],
      "decisivo": false,
      "descripcion": "Marcar como sustituida la versión aprobada anterior."
    },
    "record_version.discard": {
      "entidad": "record_version",
      "permitido": [
        "human"
      ],
      "decisivo": false,
      "descripcion": "Descartar una versión en borrador."
    },
    "criterion.record": {
      "entidad": "criterion",
      "permitido": [
        "human"
      ],
      "decisivo": false,
      "descripcion": "Registrar un criterio de aceptación dentro de una versión."
    },
    "link.create": {
      "entidad": "link",
      "permitido": [
        "human"
      ],
      "decisivo": false,
      "descripcion": "Crear un enlace tipado entre versiones."
    },
    "link.flag_review": {
      "entidad": "link",
      "permitido": [
        "system"
      ],
      "decisivo": false,
      "descripcion": "Marcar un enlace como pendiente de revisión."
    },
    "link.keep": {
      "entidad": "link",
      "permitido": [
        "human"
      ],
      "decisivo": false,
      "descripcion": "Mantener un enlace revisado."
    },
    "link.change": {
      "entidad": "link",
      "permitido": [
        "human"
      ],
      "decisivo": false,
      "descripcion": "Dar por cambiado un enlace revisado."
    },
    "link.obsolete": {
      "entidad": "link",
      "permitido": [
        "human"
      ],
      "decisivo": false,
      "descripcion": "Dar por obsoleto un enlace revisado."
    },
    "batch.submit": {
      "entidad": "batch",
      "permitido": [
        "agent_run",
        "agent_external",
        "system"
      ],
      "decisivo": false,
      "descripcion": "Enviar un lote de propuestas."
    },
    "design.import": {
      "entidad": "batch",
      "permitido": [
        "human",
        "system"
      ],
      "decisivo": false,
      "descripcion": "Importar design/ como lote pendiente."
    },
    "batch.accept_package": {
      "entidad": "batch",
      "permitido": [
        "human"
      ],
      "decisivo": true,
      "descripcion": "Aceptar en un paso un paquete coherente del sistema."
    },
    "batch.reject_package": {
      "entidad": "batch",
      "permitido": [
        "human"
      ],
      "decisivo": false,
      "descripcion": "Rechazar un paquete completo."
    },
    "batch.close": {
      "entidad": "batch",
      "permitido": [
        "system"
      ],
      "decisivo": false,
      "descripcion": "Cerrar un lote cuando todos sus elementos están resueltos."
    },
    "batch.supersede": {
      "entidad": "batch",
      "permitido": [
        "system"
      ],
      "decisivo": false,
      "descripcion": "Dejar obsoleto un lote pendiente."
    },
    "proposal.create": {
      "entidad": "proposal",
      "permitido": [
        "agent_run",
        "agent_external",
        "system"
      ],
      "decisivo": false,
      "descripcion": "Crear una propuesta dentro de un lote."
    },
    "proposal.accept": {
      "entidad": "proposal",
      "permitido": [
        "human"
      ],
      "decisivo": true,
      "descripcion": "Aceptar una propuesta."
    },
    "proposal.accept_edited": {
      "entidad": "proposal",
      "permitido": [
        "human"
      ],
      "decisivo": true,
      "descripcion": "Aceptar una propuesta con cambios de la persona."
    },
    "proposal.reject": {
      "entidad": "proposal",
      "permitido": [
        "human"
      ],
      "decisivo": false,
      "descripcion": "Rechazar una propuesta con un motivo opcional."
    },
    "proposal.supersede": {
      "entidad": "proposal",
      "permitido": [
        "system"
      ],
      "decisivo": false,
      "descripcion": "Dejar obsoleta una propuesta pendiente."
    },
    "run.request": {
      "entidad": "ai_run",
      "permitido": [
        "human",
        "system"
      ],
      "decisivo": false,
      "descripcion": "Solicitar una ejecución de un agente."
    },
    "run.retry": {
      "entidad": "ai_run",
      "permitido": [
        "human"
      ],
      "decisivo": false,
      "descripcion": "Reintentar una ejecución terminada con el mismo context pack."
    },
    "run.begin": {
      "entidad": "ai_run",
      "permitido": [
        "system"
      ],
      "decisivo": false,
      "descripcion": "Empezar una ejecución encolada."
    },
    "run.complete": {
      "entidad": "ai_run",
      "permitido": [
        "system"
      ],
      "decisivo": false,
      "descripcion": "Completar una ejecución con salida válida."
    },
    "run.fail": {
      "entidad": "ai_run",
      "permitido": [
        "system"
      ],
      "decisivo": false,
      "descripcion": "Dar por fallida una ejecución con su failure_kind."
    },
    "run.cancel": {
      "entidad": "ai_run",
      "permitido": [
        "human"
      ],
      "decisivo": false,
      "descripcion": "Cancelar una ejecución encolada o en curso."
    },
    "run.interrupt": {
      "entidad": "ai_run",
      "permitido": [
        "system"
      ],
      "decisivo": false,
      "descripcion": "Marcar como interrumpida una ejecución irrecuperable."
    },
    "context_pack.build": {
      "entidad": "context_pack",
      "permitido": [
        "system"
      ],
      "decisivo": false,
      "descripcion": "Construir y guardar un context pack inmutable."
    },
    "taxonomy.propose": {
      "entidad": "taxonomy",
      "permitido": [
        "human"
      ],
      "decisivo": false,
      "descripcion": "Proponer una versión de la taxonomía."
    },
    "taxonomy.approve": {
      "entidad": "taxonomy",
      "permitido": [
        "human"
      ],
      "decisivo": true,
      "descripcion": "Aprobar una versión de la taxonomía."
    },
    "taxonomy.supersede": {
      "entidad": "taxonomy",
      "permitido": [
        "system"
      ],
      "decisivo": false,
      "descripcion": "Marcar como sustituida la taxonomía aprobada anterior."
    },
    "classification.record": {
      "entidad": "classification",
      "permitido": [
        "system"
      ],
      "decisivo": false,
      "descripcion": "Guardar una clasificación con confianza suficiente."
    },
    "classification.hold": {
      "entidad": "classification",
      "permitido": [
        "system"
      ],
      "decisivo": false,
      "descripcion": "Guardar una clasificación de confianza baja pendiente de la persona."
    },
    "classification.resolve": {
      "entidad": "classification",
      "permitido": [
        "human"
      ],
      "decisivo": false,
      "descripcion": "Resolver una clasificación pendiente."
    },
    "knowledge_update.enqueue": {
      "entidad": "knowledge_update",
      "permitido": [
        "system"
      ],
      "decisivo": false,
      "descripcion": "Encolar «Actualizar conocimiento» tras un evento de autoridad."
    },
    "knowledge_update.classify": {
      "entidad": "knowledge_update",
      "permitido": [
        "system"
      ],
      "decisivo": false,
      "descripcion": "Pasar a clasificar los candidatos."
    },
    "knowledge_update.verify": {
      "entidad": "knowledge_update",
      "permitido": [
        "system"
      ],
      "decisivo": false,
      "descripcion": "Pasar a verificar los veredictos."
    },
    "knowledge_update.apply": {
      "entidad": "knowledge_update",
      "permitido": [
        "system"
      ],
      "decisivo": false,
      "descripcion": "Aplicar al grafo un update verificado."
    },
    "knowledge_update.reject": {
      "entidad": "knowledge_update",
      "permitido": [
        "system"
      ],
      "decisivo": false,
      "descripcion": "Rechazar un update sin efectos."
    },
    "knowledge_update.retry": {
      "entidad": "knowledge_update",
      "permitido": [
        "human"
      ],
      "decisivo": false,
      "descripcion": "Volver a encolar un update rechazado."
    },
    "idea_assessment.record": {
      "entidad": "idea_assessment",
      "permitido": [
        "system"
      ],
      "decisivo": false,
      "descripcion": "Guardar la evaluación de una idea frente al conocimiento."
    },
    "change_set.propose": {
      "entidad": "change_set",
      "permitido": [
        "system"
      ],
      "decisivo": false,
      "descripcion": "Proponer un Change Set desde una FDR lista."
    },
    "change_set.accept_scope": {
      "entidad": "change_set",
      "permitido": [
        "human"
      ],
      "decisivo": true,
      "descripcion": "Aceptar el alcance de un Change Set."
    },
    "change_set.start": {
      "entidad": "change_set",
      "permitido": [
        "system"
      ],
      "decisivo": false,
      "descripcion": "Empezar la implementación."
    },
    "change_set.submit_review": {
      "entidad": "change_set",
      "permitido": [
        "system"
      ],
      "decisivo": false,
      "descripcion": "Pasar a revisión con los gates en verde."
    },
    "change_set.accept": {
      "entidad": "change_set",
      "permitido": [
        "human"
      ],
      "decisivo": true,
      "descripcion": "Aceptar el resultado."
    },
    "change_set.request_changes": {
      "entidad": "change_set",
      "permitido": [
        "human"
      ],
      "decisivo": false,
      "descripcion": "Pedir cambios desde la revisión."
    },
    "change_set.block": {
      "entidad": "change_set",
      "permitido": [
        "system"
      ],
      "decisivo": false,
      "descripcion": "Bloquear el Change Set."
    },
    "change_set.unblock": {
      "entidad": "change_set",
      "permitido": [
        "human"
      ],
      "decisivo": false,
      "descripcion": "Desbloquear el Change Set."
    },
    "change_set.pause": {
      "entidad": "change_set",
      "permitido": [
        "system"
      ],
      "decisivo": false,
      "descripcion": "Pausar porque cambió una versión del alcance."
    },
    "change_set.resume_scope": {
      "entidad": "change_set",
      "permitido": [
        "human"
      ],
      "decisivo": true,
      "descripcion": "Volver a aceptar el alcance tras una pausa."
    },
    "change_set.cancel": {
      "entidad": "change_set",
      "permitido": [
        "human"
      ],
      "decisivo": false,
      "descripcion": "Cancelar el Change Set."
    },
    "task.create": {
      "entidad": "task",
      "permitido": [
        "system"
      ],
      "decisivo": false,
      "descripcion": "Crear una tarea que cubre al menos un AC."
    },
    "task.advance": {
      "entidad": "task",
      "permitido": [
        "system"
      ],
      "decisivo": false,
      "descripcion": "Avanzar la tarea al siguiente paso del ciclo."
    },
    "task.pass": {
      "entidad": "task",
      "permitido": [
        "system"
      ],
      "decisivo": false,
      "descripcion": "Dar la tarea por superada con los gates en verde."
    },
    "task.return": {
      "entidad": "task",
      "permitido": [
        "system"
      ],
      "decisivo": false,
      "descripcion": "Devolver la tarea al implementador con la evidencia del KO."
    },
    "task.block": {
      "entidad": "task",
      "permitido": [
        "system"
      ],
      "decisivo": false,
      "descripcion": "Bloquear la tarea tras agotar los intentos."
    },
    "task.retry": {
      "entidad": "task",
      "permitido": [
        "human"
      ],
      "decisivo": false,
      "descripcion": "Reintentar una tarea bloqueada."
    },
    "task.clarify": {
      "entidad": "task",
      "permitido": [
        "human"
      ],
      "decisivo": false,
      "descripcion": "Aclarar una tarea bloqueada y reintentarla."
    },
    "acceptance_map.accept": {
      "entidad": "acceptance_check",
      "permitido": [
        "human"
      ],
      "decisivo": true,
      "descripcion": "Aceptar el mapa AC → comprobación → prueba."
    },
    "acceptance_check.propose": {
      "entidad": "acceptance_check",
      "permitido": [
        "system"
      ],
      "decisivo": false,
      "descripcion": "Proponer la prueba de un AC."
    },
    "acceptance_check.freeze": {
      "entidad": "acceptance_check",
      "permitido": [
        "system"
      ],
      "decisivo": false,
      "descripcion": "Congelar una prueba por hash."
    },
    "evidence.record": {
      "entidad": "evidence",
      "permitido": [
        "system"
      ],
      "decisivo": false,
      "descripcion": "Registrar evidencia de un gate del sistema."
    },
    "evidence.record_manual": {
      "entidad": "evidence",
      "permitido": [
        "human"
      ],
      "decisivo": false,
      "descripcion": "Registrar evidencia humana de un AC manual."
    }
  },
  "consultas": {
    "query.projects": {
      "permitido": [
        "human"
      ],
      "descripcion": "Listar proyectos."
    },
    "query.state": {
      "permitido": [
        "human",
        "agent_external"
      ],
      "descripcion": "Estado del producto."
    },
    "query.inbox": {
      "permitido": [
        "human",
        "agent_external"
      ],
      "descripcion": "Bandeja de propuestas y pendientes."
    },
    "query.explorations": {
      "permitido": [
        "human",
        "agent_external"
      ],
      "descripcion": "Exploraciones, hilos y preguntas."
    },
    "query.records": {
      "permitido": [
        "human",
        "agent_external"
      ],
      "descripcion": "Registros, versiones, criterios, enlaces y readiness."
    },
    "query.batches": {
      "permitido": [
        "human",
        "agent_external"
      ],
      "descripcion": "Lotes y propuestas."
    },
    "query.runs": {
      "permitido": [
        "human",
        "agent_external"
      ],
      "descripcion": "Ejecuciones y sus context packs."
    },
    "query.knowledge": {
      "permitido": [
        "human",
        "agent_external"
      ],
      "descripcion": "Conocimiento derivado, frescura y búsqueda."
    },
    "query.events": {
      "permitido": [
        "human",
        "agent_external"
      ],
      "descripcion": "Diario de eventos y flujo SSE."
    },
    "query.tables": {
      "permitido": [
        "human",
        "agent_external"
      ],
      "descripcion": "Tablas de capacidades y transiciones."
    },
    "query.tokens": {
      "permitido": [
        "human"
      ],
      "descripcion": "Tokens de agentes del proyecto."
    }
  }
} as const;

export const TRANSICIONES = {
  "codigo": "DAT-TRA-001",
  "version": 1,
  "estado": "propuesto",
  "entidades": {
    "project": {
      "etiqueta": "Proyecto",
      "implementado_en": "S0",
      "estados": {
        "active": "Activo",
        "archived": "Archivado"
      },
      "autoridad": [],
      "transiciones": [
        {
          "comando": "project.create",
          "desde": "nuevo",
          "hacia": "active"
        },
        {
          "comando": "project.archive",
          "desde": [
            "active"
          ],
          "hacia": "archived"
        }
      ]
    },
    "agent_token": {
      "etiqueta": "Token de agente",
      "implementado_en": "S1",
      "estados": {
        "active": "Activo",
        "revoked": "Revocado"
      },
      "autoridad": [],
      "transiciones": [
        {
          "comando": "agent_token.issue",
          "desde": "nuevo",
          "hacia": "active",
          "guardas": [
            "nombre_de_agente_valido"
          ]
        },
        {
          "comando": "agent_token.revoke",
          "desde": [
            "active"
          ],
          "hacia": "revoked"
        }
      ]
    },
    "exploration": {
      "etiqueta": "Exploración",
      "implementado_en": "S1",
      "estados": {
        "active": "Activa",
        "concluded": "Concluida",
        "set_aside": "Apartada"
      },
      "autoridad": [],
      "transiciones": [
        {
          "comando": "exploration.open",
          "desde": "nuevo",
          "hacia": "active",
          "guardas": [
            "origen_existente"
          ]
        },
        {
          "comando": "exploration.conclude",
          "desde": [
            "active"
          ],
          "hacia": "concluded"
        },
        {
          "comando": "exploration.set_aside",
          "desde": [
            "active"
          ],
          "hacia": "set_aside",
          "guardas": [
            "motivo_presente"
          ]
        },
        {
          "comando": "exploration.resume",
          "desde": [
            "concluded",
            "set_aside"
          ],
          "hacia": "active"
        }
      ]
    },
    "message": {
      "etiqueta": "Mensaje",
      "implementado_en": "S1",
      "estados": {
        "recorded": "Registrado"
      },
      "autoridad": [],
      "transiciones": [
        {
          "comando": "message.post",
          "desde": "nuevo",
          "hacia": "recorded",
          "guardas": [
            "exploracion_activa"
          ]
        }
      ]
    },
    "source": {
      "etiqueta": "Fuente",
      "implementado_en": "S1",
      "estados": {
        "registered": "Registrada"
      },
      "autoridad": [],
      "transiciones": [
        {
          "comando": "source.register",
          "desde": "nuevo",
          "hacia": "registered"
        }
      ]
    },
    "question": {
      "etiqueta": "Pregunta",
      "implementado_en": "S1",
      "estados": {
        "pending": "Pendiente",
        "inferred": "Inferida",
        "confirmed": "Confirmada",
        "postponed": "Pospuesta",
        "discarded": "Descartada"
      },
      "autoridad": [
        "confirmed"
      ],
      "transiciones": [
        {
          "comando": "question.raise",
          "desde": "nuevo",
          "hacia": "pending",
          "guardas": [
            "exploracion_activa"
          ]
        },
        {
          "comando": "question.infer",
          "desde": [
            "pending"
          ],
          "hacia": "inferred",
          "guardas": [
            "conclusion_presente"
          ]
        },
        {
          "comando": "question.confirm",
          "desde": [
            "pending",
            "inferred"
          ],
          "hacia": "confirmed",
          "guardas": [
            "conclusion_presente"
          ]
        },
        {
          "comando": "question.postpone",
          "desde": [
            "pending",
            "inferred"
          ],
          "hacia": "postponed",
          "guardas": [
            "motivo_presente"
          ]
        },
        {
          "comando": "question.discard",
          "desde": [
            "pending",
            "inferred",
            "postponed"
          ],
          "hacia": "discarded",
          "guardas": [
            "motivo_presente"
          ]
        },
        {
          "comando": "question.reopen",
          "desde": [
            "confirmed",
            "postponed",
            "discarded"
          ],
          "hacia": "pending"
        }
      ]
    },
    "record": {
      "etiqueta": "Registro",
      "implementado_en": "S1",
      "estados": {
        "registered": "Registrado"
      },
      "autoridad": [],
      "transiciones": [
        {
          "comando": "record.create",
          "desde": "nuevo",
          "hacia": "registered",
          "guardas": [
            "codigo_libre",
            "plantilla_valida"
          ]
        }
      ]
    },
    "record_version": {
      "etiqueta": "Versión de registro",
      "implementado_en": "S1",
      "estados": {
        "draft": "Borrador",
        "approved": "Aprobada",
        "superseded": "Sustituida",
        "discarded": "Descartada"
      },
      "autoridad": [
        "approved"
      ],
      "transiciones": [
        {
          "comando": "record_version.create",
          "desde": "nuevo",
          "hacia": "draft",
          "guardas": [
            "plantilla_valida",
            "arrastre_de_criterios_completo"
          ]
        },
        {
          "comando": "record_version.approve",
          "desde": [
            "draft"
          ],
          "hacia": "approved",
          "guardas": [
            "plantilla_valida"
          ]
        },
        {
          "comando": "record_version.supersede",
          "desde": [
            "approved"
          ],
          "hacia": "superseded"
        },
        {
          "comando": "record_version.discard",
          "desde": [
            "draft"
          ],
          "hacia": "discarded"
        }
      ]
    },
    "criterion": {
      "etiqueta": "Criterio de aceptación",
      "implementado_en": "S1",
      "estados": {
        "recorded": "Registrado"
      },
      "autoridad": [],
      "transiciones": [
        {
          "comando": "criterion.record",
          "desde": "nuevo",
          "hacia": "recorded",
          "guardas": [
            "version_en_borrador"
          ]
        }
      ]
    },
    "link": {
      "etiqueta": "Enlace",
      "implementado_en": "S1",
      "estados": {
        "current": "Vigente",
        "needs_review": "Pendiente de revisión",
        "kept": "Mantenido",
        "changed": "Cambiado",
        "obsolete": "Obsoleto"
      },
      "autoridad": [],
      "transiciones": [
        {
          "comando": "link.create",
          "desde": "nuevo",
          "hacia": "current",
          "guardas": [
            "extremos_existentes"
          ]
        },
        {
          "comando": "link.flag_review",
          "desde": [
            "current",
            "kept",
            "changed"
          ],
          "hacia": "needs_review"
        },
        {
          "comando": "link.keep",
          "desde": [
            "needs_review"
          ],
          "hacia": "kept"
        },
        {
          "comando": "link.change",
          "desde": [
            "needs_review"
          ],
          "hacia": "changed"
        },
        {
          "comando": "link.obsolete",
          "desde": [
            "needs_review"
          ],
          "hacia": "obsolete"
        }
      ]
    },
    "batch": {
      "etiqueta": "Lote de propuestas",
      "implementado_en": "S1",
      "estados": {
        "pending": "Pendiente",
        "accepted": "Aceptado",
        "rejected": "Rechazado",
        "resolved": "Resuelto",
        "superseded": "Obsoleto"
      },
      "autoridad": [
        "accepted"
      ],
      "transiciones": [
        {
          "comando": "batch.submit",
          "desde": "nuevo",
          "hacia": "pending",
          "guardas": [
            "lote_de_agente_externo_max_10"
          ]
        },
        {
          "comando": "design.import",
          "desde": "nuevo",
          "hacia": "pending",
          "guardas": [
            "diseno_valido"
          ]
        },
        {
          "comando": "batch.accept_package",
          "desde": [
            "pending"
          ],
          "hacia": "accepted",
          "guardas": [
            "resolucion_en_paquete",
            "dependencias_vigentes"
          ]
        },
        {
          "comando": "batch.reject_package",
          "desde": [
            "pending"
          ],
          "hacia": "rejected",
          "guardas": [
            "resolucion_en_paquete"
          ]
        },
        {
          "comando": "batch.close",
          "desde": [
            "pending"
          ],
          "hacia": "resolved",
          "guardas": [
            "todas_las_propuestas_resueltas"
          ]
        },
        {
          "comando": "batch.supersede",
          "desde": [
            "pending"
          ],
          "hacia": "superseded"
        }
      ]
    },
    "proposal": {
      "etiqueta": "Propuesta",
      "implementado_en": "S1",
      "estados": {
        "pending": "Pendiente",
        "accepted": "Aceptada",
        "accepted_edited": "Aceptada con cambios",
        "rejected": "Rechazada",
        "superseded": "Obsoleta"
      },
      "autoridad": [
        "accepted",
        "accepted_edited"
      ],
      "transiciones": [
        {
          "comando": "proposal.create",
          "desde": "nuevo",
          "hacia": "pending",
          "guardas": [
            "carga_valida"
          ]
        },
        {
          "comando": "proposal.accept",
          "desde": [
            "pending"
          ],
          "hacia": "accepted",
          "guardas": [
            "resolucion_por_elemento",
            "dependencias_vigentes"
          ]
        },
        {
          "comando": "proposal.accept_edited",
          "desde": [
            "pending"
          ],
          "hacia": "accepted_edited",
          "guardas": [
            "resolucion_por_elemento",
            "dependencias_vigentes",
            "edicion_valida"
          ]
        },
        {
          "comando": "proposal.reject",
          "desde": [
            "pending"
          ],
          "hacia": "rejected",
          "guardas": [
            "resolucion_por_elemento"
          ]
        },
        {
          "comando": "proposal.supersede",
          "desde": [
            "pending"
          ],
          "hacia": "superseded"
        }
      ]
    },
    "ai_run": {
      "etiqueta": "Ejecución de agente",
      "implementado_en": "S0",
      "estados": {
        "queued": "En cola",
        "running": "En curso",
        "completed": "Completada",
        "failed": "Fallida",
        "cancelled": "Cancelada",
        "interrupted": "Interrumpida"
      },
      "autoridad": [],
      "transiciones": [
        {
          "comando": "run.request",
          "desde": "nuevo",
          "hacia": "queued",
          "guardas": [
            "grafo_al_dia"
          ]
        },
        {
          "comando": "run.retry",
          "desde": "nuevo",
          "hacia": "queued",
          "guardas": [
            "run_original_terminado"
          ]
        },
        {
          "comando": "run.begin",
          "desde": [
            "queued"
          ],
          "hacia": "running"
        },
        {
          "comando": "run.complete",
          "desde": [
            "running"
          ],
          "hacia": "completed"
        },
        {
          "comando": "run.fail",
          "desde": [
            "queued",
            "running"
          ],
          "hacia": "failed"
        },
        {
          "comando": "run.cancel",
          "desde": [
            "queued",
            "running"
          ],
          "hacia": "cancelled"
        },
        {
          "comando": "run.interrupt",
          "desde": [
            "running"
          ],
          "hacia": "interrupted"
        }
      ]
    },
    "context_pack": {
      "etiqueta": "Context pack",
      "implementado_en": "S1",
      "estados": {
        "recorded": "Registrado"
      },
      "autoridad": [],
      "transiciones": [
        {
          "comando": "context_pack.build",
          "desde": "nuevo",
          "hacia": "recorded"
        }
      ]
    },
    "taxonomy": {
      "etiqueta": "Taxonomía",
      "implementado_en": "S2",
      "estados": {
        "draft": "Borrador",
        "approved": "Aprobada",
        "superseded": "Sustituida"
      },
      "autoridad": [
        "approved"
      ],
      "transiciones": [
        {
          "comando": "taxonomy.propose",
          "desde": "nuevo",
          "hacia": "draft",
          "guardas": [
            "taxonomia_valida"
          ]
        },
        {
          "comando": "taxonomy.approve",
          "desde": [
            "draft"
          ],
          "hacia": "approved"
        },
        {
          "comando": "taxonomy.supersede",
          "desde": [
            "approved"
          ],
          "hacia": "superseded"
        }
      ]
    },
    "classification": {
      "etiqueta": "Clasificación",
      "implementado_en": "S2",
      "estados": {
        "applied": "Aplicada",
        "pending_review": "Pendiente de revisión",
        "resolved": "Resuelta"
      },
      "autoridad": [],
      "transiciones": [
        {
          "comando": "classification.record",
          "desde": "nuevo",
          "hacia": "applied"
        },
        {
          "comando": "classification.hold",
          "desde": "nuevo",
          "hacia": "pending_review"
        },
        {
          "comando": "classification.resolve",
          "desde": [
            "pending_review"
          ],
          "hacia": "resolved",
          "guardas": [
            "categorias_de_la_taxonomia"
          ]
        }
      ]
    },
    "knowledge_update": {
      "etiqueta": "Actualización de conocimiento",
      "implementado_en": "S2",
      "estados": {
        "queued": "En cola",
        "classifying": "Clasificando",
        "verifying": "Verificando",
        "applied": "Aplicada",
        "rejected": "Rechazada"
      },
      "autoridad": [],
      "transiciones": [
        {
          "comando": "knowledge_update.enqueue",
          "desde": "nuevo",
          "hacia": "queued"
        },
        {
          "comando": "knowledge_update.classify",
          "desde": [
            "queued"
          ],
          "hacia": "classifying"
        },
        {
          "comando": "knowledge_update.verify",
          "desde": [
            "classifying"
          ],
          "hacia": "verifying"
        },
        {
          "comando": "knowledge_update.apply",
          "desde": [
            "verifying"
          ],
          "hacia": "applied"
        },
        {
          "comando": "knowledge_update.reject",
          "desde": [
            "classifying",
            "verifying"
          ],
          "hacia": "rejected"
        },
        {
          "comando": "knowledge_update.retry",
          "desde": [
            "rejected"
          ],
          "hacia": "queued"
        }
      ]
    },
    "idea_assessment": {
      "etiqueta": "Evaluación de idea",
      "implementado_en": "S2",
      "estados": {
        "recorded": "Registrada"
      },
      "autoridad": [],
      "transiciones": [
        {
          "comando": "idea_assessment.record",
          "desde": "nuevo",
          "hacia": "recorded"
        }
      ]
    },
    "change_set": {
      "etiqueta": "Change Set",
      "implementado_en": "S3",
      "estados": {
        "proposed": "Propuesto",
        "scope_accepted": "Alcance aceptado",
        "in_progress": "En curso",
        "in_review": "En revisión",
        "accepted": "Aceptado",
        "blocked": "Bloqueado",
        "paused": "Pausado",
        "cancelled": "Cancelado"
      },
      "autoridad": [
        "scope_accepted",
        "accepted"
      ],
      "transiciones": [
        {
          "comando": "change_set.propose",
          "desde": "nuevo",
          "hacia": "proposed",
          "guardas": [
            "fdr_lista_para_construir"
          ]
        },
        {
          "comando": "change_set.accept_scope",
          "desde": [
            "proposed"
          ],
          "hacia": "scope_accepted",
          "guardas": [
            "fdr_lista_para_construir",
            "cobertura_completa"
          ]
        },
        {
          "comando": "change_set.start",
          "desde": [
            "scope_accepted"
          ],
          "hacia": "in_progress",
          "guardas": [
            "grafo_al_dia"
          ]
        },
        {
          "comando": "change_set.submit_review",
          "desde": [
            "in_progress"
          ],
          "hacia": "in_review",
          "guardas": [
            "gates_en_verde"
          ]
        },
        {
          "comando": "change_set.accept",
          "desde": [
            "in_review"
          ],
          "hacia": "accepted"
        },
        {
          "comando": "change_set.request_changes",
          "desde": [
            "in_review"
          ],
          "hacia": "in_progress"
        },
        {
          "comando": "change_set.block",
          "desde": [
            "in_progress"
          ],
          "hacia": "blocked"
        },
        {
          "comando": "change_set.unblock",
          "desde": [
            "blocked"
          ],
          "hacia": "in_progress"
        },
        {
          "comando": "change_set.pause",
          "desde": [
            "scope_accepted",
            "in_progress",
            "in_review",
            "blocked"
          ],
          "hacia": "paused"
        },
        {
          "comando": "change_set.resume_scope",
          "desde": [
            "paused"
          ],
          "hacia": "scope_accepted",
          "guardas": [
            "fdr_lista_para_construir",
            "cobertura_completa"
          ]
        },
        {
          "comando": "change_set.cancel",
          "desde": [
            "proposed",
            "scope_accepted",
            "in_progress",
            "in_review",
            "blocked",
            "paused"
          ],
          "hacia": "cancelled",
          "guardas": [
            "motivo_presente"
          ]
        }
      ]
    },
    "task": {
      "etiqueta": "Tarea",
      "implementado_en": "S3",
      "estados": {
        "open": "Abierta",
        "tests_written": "Pruebas escritas",
        "tests_frozen": "Pruebas congeladas",
        "implementing": "Implementando",
        "checking": "Comprobando",
        "passed": "Superada",
        "blocked": "Bloqueada"
      },
      "autoridad": [],
      "transiciones": [
        {
          "comando": "task.create",
          "desde": "nuevo",
          "hacia": "open",
          "guardas": [
            "cubre_al_menos_un_ac_aprobado"
          ]
        },
        {
          "comando": "task.advance",
          "desde": [
            "open"
          ],
          "hacia": "tests_written"
        },
        {
          "comando": "task.advance",
          "desde": [
            "tests_written"
          ],
          "hacia": "tests_frozen"
        },
        {
          "comando": "task.advance",
          "desde": [
            "tests_frozen"
          ],
          "hacia": "implementing"
        },
        {
          "comando": "task.advance",
          "desde": [
            "implementing"
          ],
          "hacia": "checking"
        },
        {
          "comando": "task.pass",
          "desde": [
            "checking"
          ],
          "hacia": "passed",
          "guardas": [
            "gates_en_verde"
          ]
        },
        {
          "comando": "task.return",
          "desde": [
            "checking"
          ],
          "hacia": "implementing",
          "guardas": [
            "quedan_intentos"
          ]
        },
        {
          "comando": "task.block",
          "desde": [
            "open",
            "tests_written",
            "tests_frozen",
            "implementing",
            "checking"
          ],
          "hacia": "blocked"
        },
        {
          "comando": "task.retry",
          "desde": [
            "blocked"
          ],
          "hacia": "implementing"
        },
        {
          "comando": "task.clarify",
          "desde": [
            "blocked"
          ],
          "hacia": "implementing",
          "guardas": [
            "aclaracion_presente"
          ]
        }
      ]
    },
    "acceptance_check": {
      "etiqueta": "Prueba de aceptación",
      "implementado_en": "S3",
      "estados": {
        "proposed": "Propuesta",
        "mapped": "Mapa aceptado",
        "frozen": "Congelada"
      },
      "autoridad": [
        "mapped"
      ],
      "transiciones": [
        {
          "comando": "acceptance_check.propose",
          "desde": "nuevo",
          "hacia": "proposed"
        },
        {
          "comando": "acceptance_map.accept",
          "desde": [
            "proposed"
          ],
          "hacia": "mapped"
        },
        {
          "comando": "acceptance_check.freeze",
          "desde": [
            "mapped"
          ],
          "hacia": "frozen",
          "guardas": [
            "prueba_en_rojo_sobre_la_base"
          ]
        }
      ]
    },
    "evidence": {
      "etiqueta": "Evidencia",
      "implementado_en": "S4",
      "estados": {
        "recorded": "Registrada"
      },
      "autoridad": [],
      "transiciones": [
        {
          "comando": "evidence.record",
          "desde": "nuevo",
          "hacia": "recorded"
        },
        {
          "comando": "evidence.record_manual",
          "desde": "nuevo",
          "hacia": "recorded",
          "guardas": [
            "ac_manual"
          ]
        }
      ]
    }
  }
} as const;
