import hashlib
import json
import re
import uuid
from datetime import datetime, timezone
from fastapi import HTTPException
from .db import rows

KINDS = {"decision", "fdr", "adr"}
ORIGINS = {"manual", "message", "card", "source", "proposal"}
DESIGN_STATUSES = {"draft", "approved", "superseded"}

def now():
    return datetime.now(timezone.utc).isoformat()

def uid(prefix):
    return f"{prefix}-{uuid.uuid4().hex[:12]}"

def fail(message, status=400):
    raise HTTPException(status, message)

def one(db, sql, params=()):
    row = db.execute(sql, params).fetchone()
    return dict(row) if row else None

def audit(db, entity_type, entity_id, action, origin_type="manual", origin_id=None, reason="", payload=None):
    db.execute("INSERT INTO audit_events VALUES (?,?,?,?,?,?,?,?,?)", (uid("evt"),entity_type,entity_id,action,origin_type,origin_id,reason,json.dumps(payload or {},ensure_ascii=False),now()))

def index(db, kind, id, title, body):
    db.execute("DELETE FROM search_index WHERE entity_type=? AND entity_id=?",(kind,id))
    db.execute("INSERT INTO search_index VALUES (?,?,?,?)",(kind,id,title,body))

def existing_lines(db, exploration_id):
    accepted=rows(db,"SELECT title,'accepted' AS status FROM explorations WHERE parent_id=? ORDER BY created_at",(exploration_id,))
    pending=rows(db,"SELECT json_extract(payload,'$.title') AS title,json_extract(payload,'$.body') AS body,'pending' AS status FROM proposals WHERE kind='exploration' AND status='pending' AND json_extract(payload,'$.parent_id')=? ORDER BY created_at",(exploration_id,))
    superseded=rows(db,"SELECT json_extract(payload,'$.title') AS title,json_extract(payload,'$.body') AS body,'superseded' AS status FROM proposals WHERE kind='exploration' AND status='superseded' AND json_extract(payload,'$.parent_id')=? ORDER BY created_at DESC LIMIT 8",(exploration_id,))
    return {"accepted":accepted,"pending":pending,"superseded":superseded}

def supersede_pending_proposals(db, exploration_id, card_id, origin_id, origin_type="message"):
    """A later human change invalidates drafts from the affected conversation."""
    excluded_message_id=origin_id if origin_type=="message" else ""
    if card_id:
        proposals=rows(db,"""SELECT p.id,p.batch_id FROM proposals p JOIN proposal_batches b ON b.id=p.batch_id
            WHERE p.status='pending' AND (
                (b.source_type='message' AND b.source_id IN (SELECT id FROM messages WHERE exploration_id=? AND card_id=? AND id<>?))
                OR (b.source_type='round' AND b.source_id IN (SELECT round_id FROM cards WHERE id=? AND round_id IS NOT NULL))
            )""",(exploration_id,card_id,excluded_message_id,card_id))
    else:
        proposals=rows(db,"""SELECT p.id,p.batch_id FROM proposals p JOIN proposal_batches b ON b.id=p.batch_id
            WHERE p.status='pending' AND (
                (b.source_type='message' AND b.source_id IN (SELECT id FROM messages WHERE exploration_id=? AND card_id IS NULL AND id<>?))
                OR (b.source_type='round' AND b.source_id IN (SELECT id FROM exploration_rounds WHERE exploration_id=?))
            )""",(exploration_id,excluded_message_id,exploration_id))
    for proposal in proposals:
        db.execute("UPDATE proposals SET status='superseded' WHERE id=?",(proposal["id"],))
        audit(db,"proposal",proposal["id"],"superseded",origin_type,origin_id,"Un cambio posterior requiere revisar esta propuesta")
    for batch_id in {proposal["batch_id"] for proposal in proposals}:
        if not one(db,"SELECT id FROM proposals WHERE batch_id=? AND status='pending'",(batch_id,)):
            db.execute("UPDATE proposal_batches SET status='resolved' WHERE id=?",(batch_id,))
    return len(proposals)

def round_review_context(db, round_id):
    item=one(db,"SELECT r.*,e.title AS exploration_title,p.name AS project_name FROM exploration_rounds r JOIN explorations e ON e.id=r.exploration_id JOIN projects p ON p.id=e.project_id WHERE r.id=?",(round_id,))
    if not item: fail("Ronda no encontrada",404)
    if item["status"]!="closed": fail("La ronda debe estar cerrada")
    cards=rows(db,"SELECT id,question,reason,conclusion,status FROM cards WHERE round_id=? ORDER BY created_at,id",(round_id,))
    for card in cards:
        card["messages"]=rows(db,"SELECT role,body FROM messages WHERE card_id=? ORDER BY created_at,id",(card["id"],))
    return {"mode":"round_review","project":{"name":item["project_name"]},"exploration":{"id":item["exploration_id"],"title":item["exploration_title"]},"initial_vision":one(db,"SELECT body FROM messages WHERE exploration_id=? AND card_id IS NULL AND role='user' ORDER BY created_at,id LIMIT 1",(item["exploration_id"],)),"round":{"id":round_id,"cards":cards,"observations":rows(db,"SELECT kind,content FROM exploration_observations WHERE round_id=? ORDER BY created_at,id",(round_id,))},"existing_lines":existing_lines(db,item["exploration_id"])}

def check_origin(db, origin_type, origin_id):
    if origin_type not in ORIGINS: fail("Origen no válido")
    if origin_type == "manual": return
    table = {"message":"messages","card":"cards","source":"sources","proposal":"proposals"}[origin_type]
    if not origin_id or not one(db,f"SELECT id FROM {table} WHERE id=?",(origin_id,)): fail("El origen indicado no existe")

def record(db, data, origin_type="manual", origin_id=None):
    kind=data.get("kind")
    if kind not in KINDS: fail("Tipo de registro no válido")
    title=str(data.get("title","")).strip(); body=str(data.get("body","")).strip()
    if not title or not body: fail("Título y contenido son obligatorios")
    check_origin(db,origin_type,origin_id)
    status=str(data.get("status") or "draft")
    if status not in DESIGN_STATUSES: fail("Estado de diseño no válido")
    if kind=="decision" and status=="approved" and origin_type=="card" and one(db,"SELECT status FROM cards WHERE id=?",(origin_id,))["status"]!="confirmed": fail("Una tarjeta no confirmada no puede justificar una decisión aprobada")
    exploration_id=data.get("exploration_id")
    if exploration_id and not one(db,"SELECT id FROM explorations WHERE id=?",(exploration_id,)): fail("Exploración no encontrada",404)
    if exploration_id and origin_type=="message" and not one(db,"SELECT id FROM messages WHERE id=? AND exploration_id=?",(origin_id,exploration_id)): fail("El mensaje de origen pertenece a otra exploración")
    if exploration_id and origin_type=="card" and not one(db,"SELECT id FROM cards WHERE id=? AND exploration_id=?",(origin_id,exploration_id)): fail("La tarjeta de origen pertenece a otra exploración")
    decision_id=data.get("decision_id")
    if kind in {"adr","fdr"} and exploration_id:
        decision=one(db,"SELECT id,exploration_id,current_revision FROM records WHERE id=? AND kind='decision'",(decision_id,))
        if not decision or decision["exploration_id"]!=exploration_id: fail("El diseño necesita una decisión de la misma exploración")
    id=uid(kind); t=now()
    db.execute("INSERT INTO records(id,kind,title,current_revision,created_at,exploration_id) VALUES (?,?,?,?,?,?)",(id,kind,title,1,t,exploration_id))
    db.execute("INSERT INTO revisions VALUES (?,?,?,?,?,?,?,?)",(id,1,body,str(data.get("reason") or "Creación"),status,origin_type,origin_id,t))
    audit(db,"record",id,"created",origin_type,origin_id,data.get("reason") or "Creación",{"version":1})
    index(db,kind,id,title,body)
    if decision_id and kind in {"adr","fdr"} and exploration_id:
        link(db,{"source_type":"record","source_id":decision_id,"source_version":decision["current_revision"],"target_type":"record","target_id":id,"target_version":1,"relation":"design_of"})
    return id

def revise(db,id,data):
    r=one(db,"SELECT * FROM records WHERE id=?",(id,))
    if not r: fail("Registro no encontrado",404)
    body=str(data.get("body","")).strip(); reason=str(data.get("reason","")).strip()
    if not body or not reason: fail("Contenido y motivo del cambio son obligatorios")
    title=str(data.get("title",r["title"])).strip()
    if not title: fail("El título es obligatorio")
    ot=data.get("origin_type","manual"); oi=data.get("origin_id")
    check_origin(db,ot,oi)
    status=str(data.get("status") or "draft")
    if status not in DESIGN_STATUSES: fail("Estado de diseño no válido")
    if r["kind"]=="decision" and status=="approved" and ot=="card" and one(db,"SELECT status FROM cards WHERE id=?",(oi,))["status"]!="confirmed": fail("Una tarjeta no confirmada no puede justificar una decisión aprobada")
    v=r["current_revision"]+1
    db.execute("INSERT INTO revisions VALUES (?,?,?,?,?,?,?,?)",(id,v,body,reason,status,ot,oi,now()))
    db.execute("UPDATE records SET current_revision=?,title=? WHERE id=?",(v,title,id))
    audit(db,"record",id,"revised",ot,oi,reason,{"version":v,"previous_version":v-1})
    index(db,r["kind"],id,title,body)
    return v

def link(db,data):
    st=data.get("source_type"); tt=data.get("target_type")
    tables={"record":"records","criterion":"criteria","task":"tasks","changeset":"changesets","exploration":"explorations","card":"cards","source":"sources"}
    if st not in tables or tt not in tables: fail("Tipo de relación no válido")
    sid=data.get("source_id"); tid=data.get("target_id")
    for typ,id,ver in [(st,sid,data.get("source_version")),(tt,tid,data.get("target_version"))]:
        if not one(db,f"SELECT id FROM {tables[typ]} WHERE id=?",(id,)): fail(f"{typ} {id} no existe")
        if typ=="record" and (not isinstance(ver,int) or not one(db,"SELECT version FROM revisions WHERE record_id=? AND version=?",(id,ver))): fail("La relación debe señalar una revisión existente")
    id=uid("link")
    db.execute("INSERT INTO links VALUES (?,?,?,?,?,?,?,?,?,?)",(id,st,sid,data.get("source_version"),tt,tid,data.get("target_version"),data.get("relation") or "related", "current",now()))
    audit(db,"link",id,"created",payload=data)
    return id

def criterion(db,data):
    rid=data.get("record_id"); v=data.get("record_version")
    if not one(db,"SELECT version FROM revisions WHERE record_id=? AND version=?",(rid,v)): fail("La revisión de origen no existe")
    body=str(data.get("body","")).strip()
    if not body: fail("El criterio debe describir una condición observable")
    id=uid("ac")
    db.execute("INSERT INTO criteria VALUES (?,?,?,?,?,?)",(id,body,rid,v,"open",now()))
    audit(db,"criterion",id,"created",payload={"record_id":rid,"version":v})
    index(db,"criterion",id,id,body)
    return id

def task(db,data):
    ids=list(dict.fromkeys(data.get("criterion_ids") or []))
    if not ids: fail("La tarea necesita al menos un criterio")
    for cid in ids:
        if not one(db,"SELECT id FROM criteria WHERE id=?",(cid,)): fail(f"Criterio {cid} inexistente")
    title=str(data.get("title","")).strip()
    if not title: fail("La tarea necesita título")
    id=uid("task")
    db.execute("INSERT INTO tasks VALUES (?,?,?,?,?,?,?)",(id,title,str(data.get("body") or ""),"open",str(data.get("area") or ""),str(data.get("domain") or ""),now()))
    for cid in ids: db.execute("INSERT INTO task_criteria VALUES (?,?)",(id,cid))
    audit(db,"task",id,"created",payload={"criterion_ids":ids})
    index(db,"task",id,title,str(data.get("body") or ""))
    return id

def changeset(db,data):
    title=str(data.get("title","")).strip()
    if not title: fail("El Change Set necesita título")
    id=uid("cs")
    db.execute("INSERT INTO changesets(id,title,outcome,status,created_at,reason,included,excluded,dependencies) VALUES (?,?,?,?,?,?,?,?,?)",(id,title,str(data.get("outcome") or ""),"draft",now(),str(data.get("reason") or ""),str(data.get("included") or ""),str(data.get("excluded") or ""),str(data.get("dependencies") or "")))
    for cid in set(data.get("criterion_ids") or []):
        if not one(db,"SELECT id FROM criteria WHERE id=?",(cid,)): fail(f"Criterio {cid} inexistente")
        db.execute("INSERT INTO changeset_criteria VALUES (?,?)",(id,cid))
    for tid in set(data.get("task_ids") or []):
        if not one(db,"SELECT id FROM tasks WHERE id=?",(tid,)): fail(f"Tarea {tid} inexistente")
        db.execute("INSERT INTO changeset_tasks VALUES (?,?)",(id,tid))
    for eid in set(data.get("origin_exploration_ids") or []):
        link(db,{"source_type":"exploration","source_id":eid,"target_type":"changeset","target_id":id,"relation":"origin"})
    audit(db,"changeset",id,"created")
    return id

def accept_scope(db,id):
    if not one(db,"SELECT id FROM changesets WHERE id=?",(id,)): fail("Change Set no encontrado",404)
    if not one(db,"SELECT criterion_id FROM changeset_criteria WHERE changeset_id=? LIMIT 1",(id,)): fail("El Change Set necesita criterios en su alcance")
    if not one(db,"SELECT task_id FROM changeset_tasks WHERE changeset_id=? LIMIT 1",(id,)): fail("El Change Set necesita tareas en su alcance")
    missing=rows(db,"SELECT cc.criterion_id FROM changeset_criteria cc WHERE cc.changeset_id=? AND NOT EXISTS (SELECT 1 FROM task_criteria tc JOIN changeset_tasks ct ON ct.task_id=tc.task_id WHERE ct.changeset_id=cc.changeset_id AND tc.criterion_id=cc.criterion_id)",(id,))
    if missing: fail("Hay criterios sin tarea dentro del Change Set: "+", ".join(x["criterion_id"] for x in missing))
    db.execute("UPDATE changesets SET status='scope_accepted' WHERE id=?",(id,))
    audit(db,"changeset",id,"scope_accepted")

def import_vision(db,name,content):
    digest=hashlib.sha256(content.encode("utf-8")).hexdigest()
    old=one(db,"SELECT id FROM sources WHERE digest=?",(digest,))
    if old: return {"source_id":old["id"],"duplicate":True}
    sid=uid("src"); bid=uid("batch"); t=now()
    db.execute("INSERT INTO sources VALUES (?,?,?,?,?)",(sid,name,digest,content,t))
    index(db,"source",sid,name,content)
    db.execute("INSERT INTO proposal_batches VALUES (?,?,?,?,?)",(bid,"source",sid,"pending",t))
    sections=re.split(r"(?=^## \d+\. )",content,flags=re.M)
    for section in sections:
        lines=section.strip().splitlines()
        if not lines or not lines[0].startswith("## "): continue
        title=re.sub(r"^## \d+\.\s*","",lines[0]).strip()
        body="\n".join(lines[1:]).strip()[:10000]
        if not body: continue
        payload={"kind":"exploration","title":title,"body":body,"source_id":sid}
        db.execute("INSERT INTO proposals VALUES (?,?,?,?,?,?)",(uid("prop"),bid,"exploration",json.dumps(payload,ensure_ascii=False),"pending",t))
    audit(db,"source",sid,"imported","source",sid,payload={"batch_id":bid})
    return {"source_id":sid,"batch_id":bid,"duplicate":False}

def integrate_cards_if_ready(db, exploration_id):
    exploration=one(db,"SELECT id,title,parent_id FROM explorations WHERE id=?",(exploration_id,))
    cards=rows(db,"SELECT id,question,status,conclusion FROM cards WHERE exploration_id=? ORDER BY created_at,id",(exploration_id,))
    if not cards or any(card["status"]=="pending" for card in cards): return
    fingerprint=hashlib.sha256(json.dumps(cards,sort_keys=True,ensure_ascii=False).encode("utf-8")).hexdigest()
    previous=one(db,"SELECT payload FROM audit_events WHERE entity_type='exploration' AND entity_id=? AND action='cards_integrated' ORDER BY created_at DESC LIMIT 1",(exploration_id,))
    if previous and json.loads(previous["payload"]).get("fingerprint")==fingerprint: return
    labels={"confirmed":"confirmada","inferred":"conclusión inferida","deferred":"pospuesta","discarded":"descartada"}
    lines=["Síntesis de la ronda de preguntas:"]
    for card in cards:
        line=f"- [{card['id']}] {card['question']} — {labels.get(card['status'],card['status'])}"
        if card["conclusion"]: line+=f": {card['conclusion']}"
        lines.append(line)
    if any(card["status"]=="deferred" for card in cards): lines.append("Las preguntas pospuestas siguen pendientes; esta síntesis no las confirma.")
    own_message=uid("msg")
    db.execute("INSERT INTO messages(id,exploration_id,card_id,role,body,created_at) VALUES (?,?,?,?,?,?)",(own_message,exploration_id,None,"assistant","\n".join(lines),now()))
    index(db,"message",own_message,exploration["title"] if exploration else "Síntesis", "\n".join(lines))
    if exploration and exploration["parent_id"]:
        parent_message=uid("msg")
        parent_body=f"Resultado de la rama «{exploration['title']}» [{exploration_id}]:\n"+"\n".join(lines)
        db.execute("INSERT INTO messages(id,exploration_id,card_id,role,body,created_at) VALUES (?,?,?,?,?,?)",(parent_message,exploration["parent_id"],None,"assistant",parent_body,now()))
        index(db,"message",parent_message,exploration["title"],parent_body)
    audit(db,"exploration",exploration_id,"cards_integrated",payload={"fingerprint":fingerprint,"card_ids":[card["id"] for card in cards]})

def integrate_round(db, round_id):
    item=one(db,"SELECT r.*,e.title,e.parent_id FROM exploration_rounds r JOIN explorations e ON e.id=r.exploration_id WHERE r.id=?",(round_id,))
    if not item: fail("Ronda no encontrada",404)
    cards=rows(db,"SELECT id,question,reason,status,conclusion FROM cards WHERE round_id=? ORDER BY created_at,id",(round_id,))
    observations=rows(db,"SELECT kind,content FROM exploration_observations WHERE round_id=? ORDER BY created_at,id",(round_id,))
    fingerprint=hashlib.sha256(json.dumps({"cards":cards,"observations":observations},sort_keys=True,ensure_ascii=False).encode("utf-8")).hexdigest()
    previous=one(db,"SELECT payload FROM audit_events WHERE entity_type='round' AND entity_id=? AND action='closed' ORDER BY created_at DESC LIMIT 1",(round_id,))
    if previous and json.loads(previous["payload"]).get("fingerprint")==fingerprint: return
    lines=["Cierre de la ronda de exploración:"]
    for observation in observations:
        lines.append(f"- Observación ({observation['kind']}): {observation['content']}")
    if observations:
        lines.append("Las observaciones anteriores reflejan el análisis inicial de la ronda; las conclusiones confirmadas de las tarjetas pueden actualizar sus incógnitas.")
    labels={"confirmed":"confirmada por la persona","inferred":"hipótesis del agente, pendiente de confirmar","deferred":"pospuesta, sigue abierta","discarded":"descartada por la persona","pending":"sin respuesta, sigue abierta"}
    for card in cards:
        text=f"- Pregunta [{card['id']}]: {card['question']} — {labels.get(card['status'],card['status'])}"
        if card["conclusion"]: text+=f"; conclusión: {card['conclusion']} (procedencia: rama {card['id']})"
        lines.append(text)
    if not cards and not observations: lines.append("No se registraron preguntas ni observaciones.")
    body="\n".join(lines)
    db.execute("INSERT INTO messages(id,exploration_id,card_id,role,body,created_at) VALUES (?,?,NULL,'assistant',?,?)",(uid("msg"),item["exploration_id"],body,now()))
    if item["parent_id"]:
        parent_body=f"Síntesis de la ronda [{round_id}] desde «{item['title']}»:\n"+body
        db.execute("INSERT INTO messages(id,exploration_id,card_id,role,body,created_at) VALUES (?,?,NULL,'assistant',?,?)",(uid("msg"),item["parent_id"],parent_body,now()))
    db.execute("UPDATE exploration_rounds SET status='closed',closed_at=COALESCE(closed_at,?) WHERE id=?",(now(),round_id))
    audit(db,"round",round_id,"closed",payload={"fingerprint":fingerprint,"card_ids":[c["id"] for c in cards]})
