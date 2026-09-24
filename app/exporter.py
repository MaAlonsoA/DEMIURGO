"""Readable snapshot of the full local workspace."""
from .db import rows
from .domain import now

def markdown(db):
    parts=["# DEMIURGO · conocimiento del espacio",f"Exportado: {now()}","\n## Exploraciones"]
    for exp in rows(db,"SELECT * FROM explorations ORDER BY created_at"):
        parts.extend([f"### {exp['title']}",f"ID: `{exp['id']}` · Origen: `{exp['parent_id'] or exp['source_id'] or 'manual'}`"])
        for msg in rows(db,"SELECT * FROM messages WHERE exploration_id=? ORDER BY created_at",(exp["id"],)):
            parts.append(f"- **{msg['role']}** ({msg['created_at']}; tarjeta `{msg['card_id'] or 'general'}`): {msg['body']}")
        for card in rows(db,"SELECT * FROM cards WHERE exploration_id=? ORDER BY created_at",(exp["id"],)):
            parts.extend([f"- Pregunta `{card['id']}` [{card['status']}]: {card['question']}",f"  - Motivo: {card['reason'] or 'sin especificar'}",f"  - Conclusión: {card['conclusion'] or 'pendiente'}"])
    parts.append("\n## Decisiones y registros de diseño")
    for record in rows(db,"SELECT * FROM records ORDER BY created_at"):
        parts.append(f"### {record['title']} ({record['kind']}, `{record['id']}`)")
        for rev in rows(db,"SELECT * FROM revisions WHERE record_id=? ORDER BY version DESC",(record["id"],)):
            parts.extend([f"#### Versión {rev['version']} · {rev['status']}",f"Fecha: {rev['created_at']} · Origen: `{rev['origin_type']}:{rev['origin_id'] or ''}`",f"Motivo: {rev['reason']}",rev["body"]])
    parts.append("\n## Criterios y trabajo")
    for criterion in rows(db,"SELECT * FROM criteria ORDER BY created_at"):
        parts.append(f"- Criterio `{criterion['id']}`: {criterion['body']} — `{criterion['record_id']}` v{criterion['record_version']}")
    for task in rows(db,"SELECT * FROM tasks ORDER BY created_at"):
        linked=rows(db,"SELECT criterion_id FROM task_criteria WHERE task_id=?",(task["id"],))
        parts.extend([f"### Tarea: {task['title']} (`{task['id']}`, {task['status']})",task["body"] or "Sin detalle adicional",f"Criterios: {', '.join('`'+x['criterion_id']+'`' for x in linked)}"])
    parts.append("\n## Change Sets")
    for cs in rows(db,"SELECT * FROM changesets ORDER BY created_at"):
        criteria=rows(db,"SELECT criterion_id FROM changeset_criteria WHERE changeset_id=?",(cs["id"],))
        tasks=rows(db,"SELECT task_id FROM changeset_tasks WHERE changeset_id=?",(cs["id"],))
        parts.extend([f"### {cs['title']} (`{cs['id']}`, {cs['status']})",f"Resultado esperado: {cs['outcome']}",f"Motivo: {cs['reason']}",f"Incluido: {cs['included']}",f"Excluido: {cs['excluded']}",f"Dependencias: {cs['dependencies']}",f"Criterios: {', '.join('`'+x['criterion_id']+'`' for x in criteria)}",f"Tareas: {', '.join('`'+x['task_id']+'`' for x in tasks)}"])
    parts.append("\n## Comprobaciones y evidencias")
    for ev in rows(db,"SELECT * FROM evidence ORDER BY created_at"):
        parts.extend([f"### {ev['id']} · {ev['outcome']}",f"Criterio: `{ev['criterion_id']}` · Tarea: `{ev['task_id'] or ''}` · Resultado: `{ev['result_ref']}`",f"Entorno: {ev['environment']} · Configuración: {ev['configuration']}",f"Método: {ev['method']}",f"Anomalías: {ev['anomalies']}",ev["body"]])
    parts.append("\n## Relaciones")
    for relation in rows(db,"SELECT * FROM links ORDER BY created_at"):
        parts.append(f"- `{relation['source_type']}:{relation['source_id']}` v{relation['source_version'] or '—'} **{relation['relation']}** `{relation['target_type']}:{relation['target_id']}` v{relation['target_version'] or '—'} · {relation['review_status']}")
    parts.append("\n## Fuentes originales")
    for source in rows(db,"SELECT * FROM sources ORDER BY created_at"):
        parts.extend([f"### {source['name']} (`{source['id']}`)",f"SHA-256: `{source['digest']}`",*('> '+line for line in source["content"].splitlines())])
    return "\n\n".join(parts)+"\n"
