"""Canonical, source-linked project facts used by the overview and model runs."""
import hashlib
import json
import re
from .db import rows
from . import domain as d

def facts(db, project_id):
    project=d.one(db,"SELECT * FROM projects WHERE id=?",(project_id,))
    if not project: d.fail("Proyecto no encontrado",404)
    explorations=rows(db,"SELECT id,title,parent_id,origin_record_id,source_id,created_at FROM explorations WHERE project_id=? ORDER BY created_at,id",(project_id,))
    vision=d.one(db,"SELECT m.id,m.body,m.exploration_id FROM messages m JOIN explorations e ON e.id=m.exploration_id WHERE e.project_id=? AND e.parent_id IS NULL AND m.card_id IS NULL AND m.role='user' ORDER BY m.created_at,m.id LIMIT 1",(project_id,))
    cards=rows(db,"SELECT c.id,c.exploration_id,c.question,c.conclusion,c.status,c.origin_message_id FROM cards c JOIN explorations e ON e.id=c.exploration_id WHERE e.project_id=? ORDER BY c.created_at,c.id",(project_id,))
    records=rows(db,"SELECT r.id,r.exploration_id,r.kind,r.title,r.current_revision,v.body,v.status,v.origin_type,v.origin_id FROM records r JOIN explorations e ON e.id=r.exploration_id JOIN revisions v ON v.record_id=r.id AND v.version=r.current_revision WHERE e.project_id=? ORDER BY r.created_at,r.id",(project_id,))
    for record in records:
        record["revisions"]=rows(db,"SELECT version,body,status,reason,origin_type,origin_id FROM revisions WHERE record_id=? ORDER BY version",(record["id"],))
        if record["kind"]=="decision" and record["revisions"][0]["origin_type"]=="card":
            origin=next((card for card in cards if card["id"]==record["revisions"][0]["origin_id"]),None)
            record["origin_needs_review"]=bool(origin and (origin["status"]!="confirmed" or origin["conclusion"] not in record["body"]))
    proposals=rows(db,"SELECT p.id,p.kind,p.payload,p.status,b.source_type,b.source_id FROM proposals p JOIN proposal_batches b ON b.id=p.batch_id WHERE p.status='pending' AND ((b.source_type='message' AND b.source_id IN (SELECT m.id FROM messages m JOIN explorations e ON e.id=m.exploration_id WHERE e.project_id=?)) OR (b.source_type='round' AND b.source_id IN (SELECT r.id FROM exploration_rounds r JOIN explorations e ON e.id=r.exploration_id WHERE e.project_id=?)) OR (b.source_type='exploration' AND b.source_id IN (SELECT id FROM explorations WHERE project_id=?))) ORDER BY p.created_at,p.id",(project_id,project_id,project_id))
    for proposal in proposals: proposal["payload"]=json.loads(proposal["payload"])
    return {"project":project,"original_vision":vision,"explorations":explorations,"cards":cards,"records":records,"proposals":proposals}

def fingerprint(value):
    return hashlib.sha256(json.dumps(value,ensure_ascii=False,sort_keys=True).encode()).hexdigest()

def overview(db, project_id):
    value=facts(db,project_id)
    digest=fingerprint(value)
    accepted=d.one(db,"SELECT * FROM project_summaries WHERE project_id=? AND status='accepted' ORDER BY version DESC LIMIT 1",(project_id,))
    pending=d.one(db,"SELECT * FROM project_summaries WHERE project_id=? AND status='pending' ORDER BY version DESC LIMIT 1",(project_id,))
    return {**value,"facts_hash":digest,"summary":accepted,"summary_pending":pending,"summary_outdated":bool(accepted and accepted["facts_hash"]!=digest)}

def draft_confirmed_card(db, card_id):
    card=d.one(db,"SELECT * FROM cards WHERE id=?",(card_id,))
    if not card or card["status"]!='confirmed' or not card["conclusion"].strip(): return None
    existing=d.one(db,"SELECT r.id FROM records r JOIN revisions v ON v.record_id=r.id AND v.version=1 WHERE r.kind='decision' AND v.origin_type='card' AND v.origin_id=?",(card_id,))
    if existing: return existing["id"]
    # A durable choice becomes a draft. Ordinary conclusions remain exploration knowledge.
    conclusion=card["conclusion"].lower()
    question=card["question"].lower()
    durable=any(term in conclusion for term in ("queda elegid", "se elige", "se decide", "debe ", "se acuerda", "queda fijad", "mvp debe"))
    durable=durable or (" o " in question and any(term in conclusion for term in ("primera", "segunda", "opción", "alternativa")))
    if not durable: return None
    candidates=rows(db,"SELECT p.* FROM proposals p JOIN proposal_batches b ON b.id=p.batch_id WHERE p.kind='decision' AND p.status='pending' AND json_extract(p.payload,'$.exploration_id')=? ORDER BY p.created_at,p.id",(card["exploration_id"],))
    for proposal in candidates:
        payload=json.loads(proposal["payload"])
        significant=lambda text: {word for word in re.findall(r"[\wáéíóúñ]{5,}",text.lower()) if word not in {"sobre","desde","queda","parte","como","deben","puede","para","entre","decisión","propuesta","registrar"}}
        overlap=significant(card["conclusion"]) & significant(payload["body"])
        if len(overlap)<3: continue
        body=card["conclusion"]
        rid=d.record(db,{"exploration_id":card["exploration_id"],"kind":"decision","title":payload["title"],"body":body,"reason":"Elección humana confirmada; revisar redacción","status":"draft"},"card",card_id)
        db.execute("UPDATE proposals SET status='accepted' WHERE id=?",(proposal["id"],))
        d.audit(db,"proposal",proposal["id"],"converted_to_draft","card",card_id,payload={"record_id":rid})
        if not d.one(db,"SELECT id FROM proposals WHERE batch_id=? AND status='pending'",(proposal["batch_id"],)):
            db.execute("UPDATE proposal_batches SET status='resolved' WHERE id=?",(proposal["batch_id"],))
        return rid
    title="Alcance del MVP" if "considerar logrado el mvp" in question else card["question"].strip(" ¿?¡!")[:100]
    return d.record(db,{"exploration_id":card["exploration_id"],"kind":"decision","title":title,"body":card["conclusion"],"reason":"Elección humana confirmada; revisar y aprobar","status":"draft"},"card",card_id)

def backfill(db, project_id):
    for card in rows(db,"SELECT c.id FROM cards c JOIN explorations e ON e.id=c.exploration_id WHERE e.project_id=? AND c.status='confirmed'",(project_id,)):
        draft_confirmed_card(db,card["id"])
