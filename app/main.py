import json
import sqlite3
from contextlib import asynccontextmanager
from pathlib import Path
from fastapi import FastAPI, Query
from fastapi.responses import FileResponse, JSONResponse, PlainTextResponse
from pydantic import BaseModel
from alembic import command
from alembic.config import Config
from .db import DB_PATH, connect, transaction, rows
from . import domain as d
from . import codex
from . import ai_config
from . import context as portable
from . import exporter
from . import project_state

ROOT=Path(__file__).resolve().parent.parent

def startup():
    with sqlite3.connect(DB_PATH) as setup_db:
        setup_db.execute("PRAGMA journal_mode=WAL")
    cfg=Config(str(ROOT/"alembic.ini")); cfg.set_main_option("script_location",str(ROOT/"migrations"))
    command.upgrade(cfg,"head")
    with transaction() as db:
        db.execute("UPDATE ai_runs SET status='interrupted', finished_at=?, error='Proceso interrumpido por reinicio' WHERE status='running'",(d.now(),))
        for project in rows(db,"SELECT id FROM projects"):
            project_state.backfill(db,project["id"])

@asynccontextmanager
async def lifespan(_app):
    startup()
    yield

app=FastAPI(title="DEMIURGO mínimo",lifespan=lifespan)

@app.get("/healthz")
def healthz():
    return {"status": "ok"}

class Data(BaseModel):
    model_config={"extra":"allow"}
    def obj(self): return self.model_dump(exclude_unset=True)

def existing_lines(db, exploration_id):
    return d.existing_lines(db,exploration_id)

@app.get("/api/state")
def state():
    with connect() as db:
        return {"projects":rows(db,"SELECT * FROM projects ORDER BY created_at DESC"),"explorations":rows(db,"SELECT * FROM explorations ORDER BY created_at DESC"),"cards":rows(db,"SELECT * FROM cards ORDER BY created_at DESC"),"rounds":rows(db,"SELECT * FROM exploration_rounds ORDER BY created_at DESC"),"records":rows(db,"SELECT r.*,v.body,v.reason,v.status,v.origin_type,v.origin_id,v.created_at AS revision_at FROM records r JOIN revisions v ON v.record_id=r.id AND v.version=r.current_revision ORDER BY r.created_at DESC"),"criteria":rows(db,"SELECT * FROM criteria ORDER BY created_at DESC"),"tasks":rows(db,"SELECT * FROM tasks ORDER BY created_at DESC"),"task_criteria":rows(db,"SELECT * FROM task_criteria"),"changesets":rows(db,"SELECT * FROM changesets ORDER BY created_at DESC"),"changeset_criteria":rows(db,"SELECT * FROM changeset_criteria"),"changeset_tasks":rows(db,"SELECT * FROM changeset_tasks"),"batches":rows(db,"SELECT * FROM proposal_batches ORDER BY created_at DESC"),"proposals":rows(db,"SELECT * FROM proposals ORDER BY created_at DESC"),"runs":rows(db,"SELECT id,trace_id,project_id,source_id,exploration_id,round_id,card_id,message_id,attempt,status,error,provider,requested_model,requested_base_url,observed_model,reasoning_effort,method_version,started_at,finished_at,input_tokens,output_tokens FROM ai_runs WHERE project_id IS NOT NULL ORDER BY started_at DESC"),"source_runs":rows(db,"SELECT id,trace_id,source_id,attempt,status,error,provider,requested_model,requested_base_url,observed_model,reasoning_effort,started_at,finished_at,input_tokens,output_tokens FROM ai_runs WHERE source_id IS NOT NULL ORDER BY started_at DESC"),"codex_available":codex.available(),"codex_model":codex.MODEL,"codex_reasoning_effort":codex.REASONING_EFFORT,"codex_strategic_model":codex.STRATEGIC_MODEL,"codex_strategic_reasoning_effort":codex.STRATEGIC_REASONING_EFFORT,"codex_method_version":codex.METHOD_VERSION}

@app.get("/api/projects/{project_id}/overview")
def project_overview(project_id:str):
    with connect() as db: return project_state.overview(db,project_id)

@app.post("/api/projects/{project_id}/summary/propose")
def propose_project_summary(project_id:str):
    return {"run_id":codex.start_summary(project_id)}

@app.patch("/api/projects/{project_id}/summary/{summary_id}")
def update_project_summary(project_id:str,summary_id:str,data:Data):
    x=data.obj(); body=str(x.get("body") or "").strip(); action=x.get("action")
    if action not in {"edit","accept"} or not body: d.fail("La síntesis necesita contenido y una acción válida")
    with transaction() as db:
        item=d.one(db,"SELECT * FROM project_summaries WHERE id=? AND project_id=? AND status='pending'",(summary_id,project_id))
        if not item: d.fail("Síntesis pendiente no encontrada",404)
        if action=="accept" and item["facts_hash"]!=project_state.fingerprint(project_state.facts(db,project_id)):
            d.fail("Los hechos cambiaron; genera una síntesis nueva",409)
        db.execute("UPDATE project_summaries SET body=?,status=? WHERE id=?",(body,"accepted" if action=="accept" else "pending",summary_id))
        if action=="accept": db.execute("UPDATE project_summaries SET status='superseded' WHERE project_id=? AND status='accepted' AND id<>?",(project_id,summary_id))
        d.audit(db,"project_summary",summary_id,action,reason="Revisión humana")
    return {"ok":True}


RUN_SUMMARY="id,trace_id,project_id,source_id,exploration_id,round_id,card_id,message_id,attempt,status,error,provider,requested_model,requested_base_url,observed_model,reasoning_effort,agent,agent_version,method_version,started_at,finished_at,input_tokens,cached_input_tokens,output_tokens,reasoning_output_tokens,cli_invocations,turns,tool_calls,model_calls,context_ms,invocation_ms,validation_ms,persistence_ms,usage_provenance,traceparent"


@app.get("/api/ai/settings")
def ai_settings():
    return ai_config.get_settings()


@app.put("/api/ai/settings/{action_key}")
def save_ai_settings(action_key:str,data:Data):
    try: return ai_config.save_action_profile(action_key,data.obj())
    except ValueError as exc: d.fail(str(exc))


@app.get("/api/ai/models")
def ai_models(provider:str,base_url:str=""):
    try: return ai_config.get_models(provider,base_url)
    except (ValueError,RuntimeError) as exc: d.fail(str(exc),502 if isinstance(exc,RuntimeError) else 400)


@app.post("/api/ai/providers/test")
def test_ai_provider(data:Data):
    value=data.obj()
    try: return ai_config.test_provider(str(value.get("provider") or ""),str(value.get("base_url") or ""),str(value.get("model") or ""),str(value.get("reasoning_effort") or "low"))
    except (ValueError,RuntimeError) as exc: d.fail(str(exc),502 if isinstance(exc,RuntimeError) else 400)


@app.get("/api/ai/selection")
def ai_selection(scope_type:str,scope_id:str,action_key:str):
    try: return ai_config.get_selection(scope_type,scope_id,action_key)
    except ValueError as exc: d.fail(str(exc),404 if "No se encontr" in str(exc) else 400)


@app.put("/api/ai/selection")
def save_ai_selection(data:Data):
    value=data.obj()
    try:
        return ai_config.save_task_selection(str(value.get("scope_type") or ""),str(value.get("scope_id") or ""),value,bool(value.get("reset")))
    except ValueError as exc: d.fail(str(exc),404 if "No se encontr" in str(exc) else 400)

@app.get("/api/projects/{project_id}/runs")
def project_runs(project_id:str, limit:int=Query(30,ge=1,le=100), offset:int=Query(0,ge=0)):
    with connect() as db:
        if not d.one(db,"SELECT id FROM projects WHERE id=?",(project_id,)): d.fail("Proyecto no encontrado",404)
        total=db.execute("SELECT count(*) FROM ai_runs WHERE project_id=?",(project_id,)).fetchone()[0]
        return {"items":rows(db,f"SELECT {RUN_SUMMARY} FROM ai_runs WHERE project_id=? ORDER BY started_at DESC,id DESC LIMIT ? OFFSET ?",(project_id,limit,offset)),"total":total,"limit":limit,"offset":offset}

@app.get("/api/sources/{source_id}/runs")
def source_runs(source_id:str, limit:int=Query(30,ge=1,le=100), offset:int=Query(0,ge=0)):
    with connect() as db:
        if not d.one(db,"SELECT id FROM sources WHERE id=?",(source_id,)): d.fail("Fuente no encontrada",404)
        total=db.execute("SELECT count(*) FROM ai_runs WHERE source_id=?",(source_id,)).fetchone()[0]
        return {"items":rows(db,f"SELECT {RUN_SUMMARY} FROM ai_runs WHERE source_id=? ORDER BY started_at DESC,id DESC LIMIT ? OFFSET ?",(source_id,limit,offset)),"total":total,"limit":limit,"offset":offset}

@app.get("/api/runs/{id}")
def run_detail(id:str):
    with connect() as db:
        run=d.one(db,"SELECT * FROM ai_runs WHERE id=?",(id,))
        if not run: d.fail("Ejecución no encontrada",404)
        run["usage_provenance"]=json.loads(run["usage_provenance"])
        run["spans"]=rows(db,"SELECT span_id,trace_id,parent_span_id,name,started_at,finished_at,attributes_json FROM ai_spans WHERE run_id=? ORDER BY started_at",(id,))
        return run

@app.get("/api/runs/{id}/events")
def run_events(id:str, limit:int=Query(100,ge=1,le=500), offset:int=Query(0,ge=0)):
    with connect() as db:
        if not d.one(db,"SELECT id FROM ai_runs WHERE id=?",(id,)): d.fail("Ejecución no encontrada",404)
        total=db.execute("SELECT count(*) FROM ai_events WHERE run_id=?",(id,)).fetchone()[0]
        return {"items":rows(db,"SELECT seq,received_at,raw_json FROM ai_events WHERE run_id=? ORDER BY seq LIMIT ? OFFSET ?",(id,limit,offset)),"total":total,"limit":limit,"offset":offset}

@app.post("/api/projects")
def create_project(data:Data):
    name=str(data.obj().get("name") or "").strip()
    if not name: d.fail("El proyecto necesita un nombre")
    with transaction() as db:
        project_id=d.uid("project"); exploration_id=d.uid("exp"); created_at=d.now()
        db.execute("INSERT INTO projects(id,name,created_at) VALUES (?,?,?)",(project_id,name,created_at))
        db.execute("INSERT INTO explorations(id,title,parent_id,source_id,created_at,project_id) VALUES (?,?,?,?,?,?)",(exploration_id,"Exploración inicial",None,None,created_at,project_id))
        d.audit(db,"project",project_id,"created")
        d.audit(db,"exploration",exploration_id,"created","project",project_id)
        d.index(db,"exploration",exploration_id,name,"Exploración inicial")
    return {"id":project_id,"exploration_id":exploration_id}

def _purge_records(db, record_ids):
    """Remove records whose last owner disappeared, with their dependent work."""
    if not record_ids: return
    marks=",".join("?" for _ in record_ids); ids=tuple(record_ids)
    criterion_ids=[r["id"] for r in db.execute(f"SELECT id FROM criteria WHERE record_id IN ({marks})",ids)]
    if criterion_ids:
        cm=",".join("?" for _ in criterion_ids); cp=tuple(criterion_ids)
        task_ids=[r["task_id"] for r in db.execute(f"SELECT DISTINCT task_id FROM task_criteria WHERE criterion_id IN ({cm})",cp)]
        evidence_ids=[r["id"] for r in db.execute(f"SELECT id FROM evidence WHERE criterion_id IN ({cm})",cp)]
        db.execute(f"DELETE FROM evidence WHERE criterion_id IN ({cm})",cp)
        db.execute(f"DELETE FROM changeset_criteria WHERE criterion_id IN ({cm})",cp)
        db.execute(f"DELETE FROM task_criteria WHERE criterion_id IN ({cm})",cp)
        db.execute(f"DELETE FROM criteria WHERE id IN ({cm})",cp)
        for cid in criterion_ids:
            db.execute("DELETE FROM search_index WHERE entity_type='criterion' AND entity_id=?",(cid,))
            db.execute("DELETE FROM audit_events WHERE entity_type='criterion' AND entity_id=?",(cid,))
        for eid in evidence_ids: db.execute("DELETE FROM audit_events WHERE entity_type='evidence' AND entity_id=?",(eid,))
        for tid in task_ids:
            if not d.one(db,"SELECT 1 FROM task_criteria WHERE task_id=?",(tid,)):
                evidence_ids=[r["id"] for r in db.execute("SELECT id FROM evidence WHERE task_id=?",(tid,))]
                db.execute("DELETE FROM evidence WHERE task_id=?",(tid,))
                for eid in evidence_ids: db.execute("DELETE FROM audit_events WHERE entity_type='evidence' AND entity_id=?",(eid,))
                db.execute("DELETE FROM changeset_tasks WHERE task_id=?",(tid,))
                db.execute("DELETE FROM tasks WHERE id=?",(tid,))
                db.execute("DELETE FROM search_index WHERE entity_type='task' AND entity_id=?",(tid,))
                db.execute("DELETE FROM audit_events WHERE entity_type='task' AND entity_id=?",(tid,))
    link_ids=[r["id"] for r in db.execute(f"SELECT id FROM links WHERE (source_type='record' AND source_id IN ({marks})) OR (target_type='record' AND target_id IN ({marks}))",ids+ids)]
    db.execute(f"DELETE FROM links WHERE (source_type='record' AND source_id IN ({marks})) OR (target_type='record' AND target_id IN ({marks}))",ids+ids)
    for lid in link_ids: db.execute("DELETE FROM audit_events WHERE entity_type='link' AND entity_id=?",(lid,))
    db.execute(f"DELETE FROM revisions WHERE record_id IN ({marks})",ids)
    db.execute(f"DELETE FROM records WHERE id IN ({marks})",ids)
    db.execute(f"DELETE FROM audit_events WHERE entity_type='record' AND entity_id IN ({marks})",ids)
    for rid in record_ids: db.execute("DELETE FROM search_index WHERE entity_id=?",(rid,))


@app.delete("/api/projects/{project_id}")
def delete_project(project_id:str):
    """Delete a project and the conversation data owned by its explorations."""
    with transaction() as db:
        if not d.one(db,"SELECT id FROM projects WHERE id=?",(project_id,)):
            d.fail("Proyecto no encontrado",404)
        exploration_ids=[r["id"] for r in db.execute(
            "WITH RECURSIVE tree(id) AS ("
            "SELECT id FROM explorations WHERE project_id=? AND parent_id IS NULL "
            "UNION ALL SELECT e.id FROM explorations e JOIN tree t ON e.parent_id=t.id) "
            "SELECT id FROM tree",(project_id,))]
        if exploration_ids:
            marks=",".join("?" for _ in exploration_ids)
            params=tuple(exploration_ids)
            message_ids=[r["id"] for r in db.execute(f"SELECT id FROM messages WHERE exploration_id IN ({marks})",params)]
            card_ids=[r["id"] for r in db.execute(f"SELECT id FROM cards WHERE exploration_id IN ({marks})",params)]
            round_ids=[r["id"] for r in db.execute(f"SELECT id FROM exploration_rounds WHERE exploration_id IN ({marks})",params)]
            if card_ids:
                card_marks=",".join("?" for _ in card_ids)
                db.execute(f"DELETE FROM ai_task_overrides WHERE (scope_type='exploration' AND scope_id IN ({marks})) OR (scope_type='card' AND scope_id IN ({card_marks}))",params+tuple(card_ids))
            else:
                db.execute(f"DELETE FROM ai_task_overrides WHERE scope_type='exploration' AND scope_id IN ({marks})",params)
            active=[r["id"] for r in db.execute(
                "SELECT id FROM ai_runs WHERE status='running' AND project_id=?",(project_id,))]
            if active:
                d.fail("No se puede borrar el proyecto mientras DEMIURGO está procesando mensajes")
            changeset_ids=[r["target_id"] for r in db.execute(
                f"SELECT DISTINCT target_id FROM links WHERE source_type='exploration' AND source_id IN ({marks}) AND target_type='changeset' AND relation='origin'",params)]
            for changeset_id in changeset_ids:
                shared=db.execute(f"SELECT 1 FROM links WHERE target_type='changeset' AND target_id=? AND relation='origin' AND NOT (source_type='exploration' AND source_id IN ({marks})) LIMIT 1",(changeset_id,*params)).fetchone()
                if shared: continue
                link_ids=[r["id"] for r in db.execute("SELECT id FROM links WHERE (source_type='changeset' AND source_id=?) OR (target_type='changeset' AND target_id=?)",(changeset_id,changeset_id))]
                db.execute("DELETE FROM links WHERE (source_type='changeset' AND source_id=?) OR (target_type='changeset' AND target_id=?)",(changeset_id,changeset_id))
                for lid in link_ids: db.execute("DELETE FROM audit_events WHERE entity_type='link' AND entity_id=?",(lid,))
                db.execute("DELETE FROM changeset_criteria WHERE changeset_id=?",(changeset_id,))
                db.execute("DELETE FROM changeset_tasks WHERE changeset_id=?",(changeset_id,))
                db.execute("DELETE FROM audit_events WHERE entity_type='changeset' AND entity_id=?",(changeset_id,))
                db.execute("DELETE FROM changesets WHERE id=?",(changeset_id,))
            batch_ids=[r["id"] for r in db.execute(
                f"SELECT id FROM proposal_batches WHERE (source_type='exploration' AND source_id IN ({marks})) OR (source_type='message' AND source_id IN (SELECT id FROM messages WHERE exploration_id IN ({marks}))) OR (source_type='round' AND source_id IN (SELECT id FROM exploration_rounds WHERE exploration_id IN ({marks})))",params+params+params)]
            proposal_ids=[r["id"] for r in db.execute(f"SELECT id FROM proposals WHERE batch_id IN ({','.join('?' for _ in batch_ids)})",tuple(batch_ids))] if batch_ids else []
            owned_origins=[("message",message_ids),("card",card_ids),("proposal",proposal_ids)]
            record_ids=[r["id"] for r in db.execute(f"SELECT id FROM records WHERE exploration_id IN ({marks})",params)]
            for origin_type, ids in owned_origins:
                if ids:
                    record_ids.extend(r["record_id"] for r in db.execute(f"SELECT DISTINCT record_id FROM revisions WHERE origin_type=? AND origin_id IN ({','.join('?' for _ in ids)})",(origin_type,*ids)))
            record_ids=list(dict.fromkeys(record_ids))
            db.execute(f"UPDATE explorations SET origin_record_id=NULL WHERE id IN ({marks})",params)
            _purge_records(db,record_ids)
            db.execute("DELETE FROM ai_runs WHERE project_id=?",(project_id,))
            db.execute(f"DELETE FROM exploration_observations WHERE round_id IN (SELECT id FROM exploration_rounds WHERE exploration_id IN ({marks}))",params)
            db.execute(f"UPDATE cards SET round_id=NULL WHERE exploration_id IN ({marks})",params)
            db.execute(f"DELETE FROM exploration_rounds WHERE exploration_id IN ({marks})",params)
            db.execute(f"DELETE FROM messages WHERE exploration_id IN ({marks})",params)
            db.execute(f"DELETE FROM cards WHERE exploration_id IN ({marks})",params)
            if batch_ids:
                bm=",".join("?" for _ in batch_ids)
                db.execute(f"DELETE FROM audit_events WHERE (entity_type='proposal' AND entity_id IN (SELECT id FROM proposals WHERE batch_id IN ({bm}))) OR (origin_type='proposal' AND origin_id IN (SELECT id FROM proposals WHERE batch_id IN ({bm})))",tuple(batch_ids)*2)
                db.execute(f"DELETE FROM proposals WHERE batch_id IN ({bm})",tuple(batch_ids))
                db.execute(f"DELETE FROM proposal_batches WHERE id IN ({bm})",tuple(batch_ids))
            for entity_type, ids in (("message",message_ids),("card",card_ids),("round",round_ids),("proposal",proposal_ids),("exploration",exploration_ids)):
                if ids:
                    marks_ids=",".join("?" for _ in ids)
                    db.execute(f"DELETE FROM audit_events WHERE (entity_type=? AND entity_id IN ({marks_ids})) OR (origin_type=? AND origin_id IN ({marks_ids}))",(entity_type,*ids,entity_type,*ids))
                    db.execute(f"DELETE FROM search_index WHERE entity_type=? AND entity_id IN ({marks_ids})",(entity_type,*ids))
            link_ids=[r["id"] for r in db.execute(f"SELECT id FROM links WHERE (source_type='exploration' AND source_id IN ({marks})) OR (target_type='exploration' AND target_id IN ({marks}))",params+params)]
            db.execute(f"DELETE FROM links WHERE (source_type='exploration' AND source_id IN ({marks})) OR (target_type='exploration' AND target_id IN ({marks}))",params+params)
            for lid in link_ids: db.execute("DELETE FROM audit_events WHERE entity_type='link' AND entity_id=?",(lid,))
            source_ids=[r["source_id"] for r in db.execute(f"SELECT DISTINCT source_id FROM explorations WHERE id IN ({marks}) AND source_id IS NOT NULL",params)]
            db.execute(f"DELETE FROM explorations WHERE id IN ({marks})",params)
            for source_id in source_ids:
                if not d.one(db,"SELECT id FROM explorations WHERE source_id=? LIMIT 1",(source_id,)):
                    db.execute("DELETE FROM ai_task_overrides WHERE scope_type='source' AND scope_id=?",(source_id,))
                    source_proposal_ids=[r["id"] for r in db.execute("SELECT p.id FROM proposals p JOIN proposal_batches b ON b.id=p.batch_id WHERE b.source_type='source' AND b.source_id=?",(source_id,))]
                    if source_proposal_ids:
                        sm=",".join("?" for _ in source_proposal_ids)
                        source_record_ids=[r["record_id"] for r in db.execute(f"SELECT DISTINCT record_id FROM revisions WHERE origin_type='proposal' AND origin_id IN ({sm})",tuple(source_proposal_ids))]
                        _purge_records(db,source_record_ids)
                        db.execute(f"DELETE FROM audit_events WHERE entity_type='proposal' AND entity_id IN ({sm})",tuple(source_proposal_ids))
                    db.execute("DELETE FROM ai_runs WHERE source_id=?",(source_id,))
                    link_ids=[r["id"] for r in db.execute("SELECT id FROM links WHERE (source_type='source' AND source_id=?) OR (target_type='source' AND target_id=?)",(source_id,source_id))]
                    db.execute("DELETE FROM links WHERE (source_type='source' AND source_id=?) OR (target_type='source' AND target_id=?)",(source_id,source_id))
                    for lid in link_ids: db.execute("DELETE FROM audit_events WHERE entity_type='link' AND entity_id=?",(lid,))
                    db.execute("DELETE FROM proposals WHERE batch_id IN (SELECT id FROM proposal_batches WHERE source_type='source' AND source_id=?)",(source_id,))
                    db.execute("DELETE FROM proposal_batches WHERE source_type='source' AND source_id=?",(source_id,))
                    db.execute("DELETE FROM audit_events WHERE (entity_type='source' AND entity_id=?) OR (origin_type='source' AND origin_id=?)",(source_id,source_id))
                    db.execute("DELETE FROM search_index WHERE entity_type='source' AND entity_id=?",(source_id,))
                    db.execute("DELETE FROM sources WHERE id=?",(source_id,))
        db.execute("DELETE FROM audit_events WHERE entity_type='project' AND entity_id=?",(project_id,))
        db.execute("DELETE FROM audit_events WHERE entity_type='project_summary' AND entity_id IN (SELECT id FROM project_summaries WHERE project_id=?)",(project_id,))
        db.execute("DELETE FROM project_summaries WHERE project_id=?",(project_id,))
        db.execute("DELETE FROM projects WHERE id=?",(project_id,))
    return {"deleted":True,"id":project_id}

@app.post("/api/explorations")
def exploration(data:Data):
    x=data.obj(); title=str(x.get("title") or "").strip()
    purpose=str(x.get("purpose") or "").strip()
    if not title: d.fail("La exploración necesita título")
    with transaction() as db:
        parent=x.get("parent_id")
        origin=d.one(db,"SELECT id,project_id FROM explorations WHERE id=?",(parent,)) if parent else None
        if parent and not origin: d.fail("Exploración de origen no encontrada")
        origin_record_id=x.get("origin_record_id")
        if origin_record_id and (not parent or not d.one(db,"SELECT id FROM records WHERE id=? AND exploration_id=?",(origin_record_id,parent))): d.fail("El artefacto de origen debe pertenecer a la exploración anterior")
        project_id=origin["project_id"] if origin else d.uid("project")
        if not origin: db.execute("INSERT INTO projects(id,name,created_at) VALUES (?,?,?)",(project_id,title,d.now()))
        id=d.uid("exp"); db.execute("INSERT INTO explorations(id,title,parent_id,source_id,created_at,project_id,origin_record_id) VALUES (?,?,?,?,?,?,?)",(id,title,parent,x.get("source_id"),d.now(),project_id,origin_record_id))
        d.audit(db,"exploration",id,"created","record" if origin_record_id else "manual",origin_record_id,purpose)
        d.index(db,"exploration",id,title,purpose)
    return {"id":id}

@app.get("/api/explorations/{id}/messages")
def messages(id:str, card_id:str|None=None, thread:str="all"):
    with connect() as db:
        if card_id is None:
            if thread=="main": return rows(db,"SELECT * FROM messages WHERE exploration_id=? AND card_id IS NULL ORDER BY created_at,id",(id,))
            return rows(db,"SELECT * FROM messages WHERE exploration_id=? ORDER BY created_at,id",(id,))
        if not d.one(db,"SELECT id FROM cards WHERE id=? AND exploration_id=?",(card_id,id)): d.fail("La tarjeta no pertenece a esta exploración")
        return rows(db,"SELECT * FROM messages WHERE exploration_id=? AND card_id=? ORDER BY created_at,id",(id,card_id))

@app.get("/api/explorations/{id}/context")
def exploration_context(id:str, card_id:str|None=None):
    with connect() as db:
        exploration=d.one(db,"SELECT * FROM explorations WHERE id=?",(id,))
        if not exploration: d.fail("Exploración no encontrada",404)
        parent=d.one(db,"SELECT id,title FROM explorations WHERE id=?",(exploration["parent_id"],)) if exploration["parent_id"] else None
        result={"exploration":exploration,"parent":parent,"origin_kind":"project" if not parent else "manual","purpose":"","origin_text":"","origin_question":"","origin_cards":[],"origin_record":None,"origin_review":None,"confirmed":[]}
        created=d.one(db,"SELECT origin_type,origin_id,reason FROM audit_events WHERE entity_type='exploration' AND entity_id=? AND action='created' ORDER BY created_at DESC LIMIT 1",(id,))
        if created: result["purpose"]=created["reason"] or ""
        if created and created["origin_type"]=="proposal":
            proposal=d.one(db,"SELECT payload FROM proposals WHERE id=?",(created["origin_id"],))
            if proposal:
                payload=json.loads(proposal["payload"])
                result["origin_kind"]="proposal"
                result["purpose"]=payload.get("body") or ""
                round_id=payload.get("round_id")
                if round_id:
                    result["origin_cards"]=rows(db,"SELECT question,conclusion FROM cards WHERE round_id=? AND status='confirmed' ORDER BY created_at",(round_id,))
                else:
                    source=d.one(db,"SELECT m.rowid AS position,m.body,m.exploration_id,m.card_id,c.question FROM messages m LEFT JOIN cards c ON c.id=m.card_id WHERE m.id=?",(payload.get("origin_message_id"),))
                    if source:
                        result["origin_text"]=source["body"]
                        result["origin_question"]=source["question"] or ""
                        newer=d.one(db,"SELECT body FROM messages WHERE exploration_id=? AND card_id IS ? AND role='user' AND rowid>? ORDER BY rowid DESC LIMIT 1",(source["exploration_id"],source["card_id"],source["position"]))
                        if newer: result["origin_review"]={"latest_text":newer["body"]}
        elif exploration["origin_record_id"]:
            result["origin_kind"]="record"
            result["origin_record"]=d.one(db,"SELECT id,title,kind FROM records WHERE id=?",(exploration["origin_record_id"],))
        elif not parent:
            first=d.one(db,"SELECT body FROM messages WHERE exploration_id=? AND card_id IS NULL AND role='user' ORDER BY created_at,id LIMIT 1",(id,))
            result["origin_text"]=first["body"] if first else ""
        if card_id:
            card=d.one(db,"SELECT * FROM cards WHERE id=? AND exploration_id=?",(card_id,id))
            if not card: d.fail("La tarjeta no pertenece a esta exploración",404)
            result["card"]=card
            if card["origin_message_id"]:
                origin=d.one(db,"SELECT body FROM messages WHERE id=? AND exploration_id=?",(card["origin_message_id"],id))
                result["card_origin_text"]=origin["body"] if origin else ""
        else:
            result["confirmed"]=rows(db,"SELECT id,question,conclusion FROM cards WHERE exploration_id=? AND status='confirmed' ORDER BY created_at DESC LIMIT 5",(id,))
        return result

@app.get("/api/rounds/{round_id}")
def round_detail(round_id:str):
    with connect() as db:
        item=d.one(db,"SELECT * FROM exploration_rounds WHERE id=?",(round_id,))
        if not item: d.fail("Ronda no encontrada",404)
        item["cards"]=rows(db,"SELECT * FROM cards WHERE round_id=? ORDER BY created_at,id",(round_id,))
        item["observations"]=rows(db,"SELECT * FROM exploration_observations WHERE round_id=? ORDER BY created_at,id",(round_id,))
        return item

@app.post("/api/rounds/{round_id}/close")
def close_round(round_id:str):
    with transaction() as db:
        item=d.one(db,"SELECT * FROM exploration_rounds WHERE id=?",(round_id,))
        if not item: d.fail("Ronda no encontrada",404)
        db.execute("UPDATE exploration_rounds SET status='closed',closed_at=COALESCE(closed_at,?) WHERE id=?",(d.now(),round_id))
        d.integrate_round(db,round_id)
    run_id=analyze_round(round_id)["run_id"]
    return {"ok":True,"run_id":run_id}


@app.post("/api/rounds/{round_id}/analyze")
def analyze_round(round_id:str):
    with connect() as db:
        d.round_review_context(db,round_id)
    return {"run_id":codex.start_round(round_id)}

@app.get("/api/messages/{id}")
def message_detail(id:str):
    with connect() as db:
        item=d.one(db,"SELECT * FROM messages WHERE id=?",(id,))
        if not item: d.fail("Mensaje no encontrado",404)
        return item

@app.get("/api/sources/{id}")
def source(id:str):
    with connect() as db:
        result=d.one(db,"SELECT * FROM sources WHERE id=?",(id,))
        if not result: d.fail("Fuente no encontrada",404)
        return result

@app.post("/api/explorations/{id}/messages")
def message(id:str,data:Data):
    body=str(data.obj().get("body") or "").strip()
    if not body: d.fail("El mensaje está vacío")
    with transaction() as db:
        if not d.one(db,"SELECT id FROM explorations WHERE id=?",(id,)): d.fail("Exploración no encontrada",404)
        card_id=data.obj().get("card_id")
        card=d.one(db,"SELECT * FROM cards WHERE id=? AND exploration_id=?",(card_id,id)) if card_id else None
        if card_id and not card: d.fail("La tarjeta no pertenece a esta exploración")
        mid=d.uid("msg"); db.execute("INSERT INTO messages(id,exploration_id,card_id,role,body,created_at) VALUES (?,?,?,?,?,?)",(mid,id,card_id,"user",body,d.now()))
        d.supersede_pending_proposals(db,id,card_id,mid)
        d.audit(db,"message",mid,"created")
        d.index(db,"message",mid,d.one(db,"SELECT title FROM explorations WHERE id=?",(id,))["title"],body)
        context={"project":d.one(db,"SELECT p.id,p.name FROM projects p JOIN explorations e ON e.project_id=p.id WHERE e.id=?",(id,)),"exploration":d.one(db,"SELECT * FROM explorations WHERE id=?",(id,)) if card_id is None else None,"card":card,"recent_messages":rows(db,"SELECT role,body FROM (SELECT role,body,created_at,id FROM messages WHERE exploration_id=? AND card_id IS ? ORDER BY created_at DESC,id DESC LIMIT 12) ORDER BY created_at,id",(id,card_id)),"existing_lines":existing_lines(db,id)}
        if card_id:
            context["exploration_brief"]=d.one(db,"SELECT body FROM messages WHERE exploration_id=? AND card_id IS NULL AND role='user' ORDER BY created_at,id LIMIT 1",(id,))
        if card_id is None:
            context["project_knowledge"]={"observations":rows(db,"SELECT o.kind,o.content FROM exploration_observations o JOIN exploration_rounds r ON r.id=o.round_id WHERE r.exploration_id=? AND r.status='closed' ORDER BY o.created_at DESC LIMIT 30",(id,)),"confirmed_cards":rows(db,"SELECT question,conclusion FROM cards WHERE exploration_id=? AND status='confirmed'",(id,)),"design_records":rows(db,"WITH RECURSIVE tree(id) AS (SELECT id FROM explorations WHERE id=? UNION ALL SELECT e.id FROM explorations e JOIN tree t ON e.parent_id=t.id), owned_messages(id) AS (SELECT id FROM messages WHERE exploration_id IN (SELECT id FROM tree)), owned_cards(id) AS (SELECT id FROM cards WHERE exploration_id IN (SELECT id FROM tree)), owned_sources(id) AS (SELECT source_id FROM explorations WHERE id IN (SELECT id FROM tree) AND source_id IS NOT NULL), owned_proposals(id) AS (SELECT p.id FROM proposals p JOIN proposal_batches b ON b.id=p.batch_id WHERE (b.source_type='message' AND b.source_id IN (SELECT id FROM owned_messages)) OR (b.source_type='exploration' AND b.source_id IN (SELECT id FROM tree)) OR (b.source_type='source' AND b.source_id IN (SELECT id FROM owned_sources))) SELECT DISTINCT r.kind,r.title,v.body FROM records r JOIN revisions v ON v.record_id=r.id AND v.version=r.current_revision WHERE v.status='approved' AND ((v.origin_type='message' AND v.origin_id IN (SELECT id FROM owned_messages)) OR (v.origin_type='card' AND v.origin_id IN (SELECT id FROM owned_cards)) OR (v.origin_type='proposal' AND v.origin_id IN (SELECT id FROM owned_proposals))) ORDER BY r.created_at DESC LIMIT 30",(id,))}
    run_id=codex.start(mid,context)
    return {"id":mid,"run_id":run_id,"codex_available":codex.available()}

@app.post("/api/messages/{id}/retry")
def retry(id:str):
    with connect() as db:
        msg=d.one(db,"SELECT * FROM messages WHERE id=? AND role='user'",(id,))
        if not msg: d.fail("Mensaje no encontrado",404)
        context={"message":msg,"card":d.one(db,"SELECT * FROM cards WHERE id=?",(msg["card_id"],)) if msg["card_id"] else None,"project":d.one(db,"SELECT p.id,p.name FROM projects p JOIN explorations e ON e.project_id=p.id WHERE e.id=?",(msg["exploration_id"],)),"recent_messages":rows(db,"SELECT role,body FROM (SELECT role,body,created_at,id FROM messages WHERE exploration_id=? AND card_id IS ? ORDER BY created_at DESC,id DESC LIMIT 12) ORDER BY created_at,id",(msg["exploration_id"],msg["card_id"])),"existing_lines":existing_lines(db,msg["exploration_id"])}
        if msg["card_id"]:
            context["exploration_brief"]=d.one(db,"SELECT body FROM messages WHERE exploration_id=? AND card_id IS NULL AND role='user' ORDER BY created_at,id LIMIT 1",(msg["exploration_id"],))
    return {"run_id":codex.start(id,context)}

@app.post("/api/runs/{id}/cancel")
def cancel(id:str): codex.cancel(id); return {"ok":True}

@app.post("/api/cards")
def card(data:Data):
    x=data.obj(); eid=x.get("exploration_id")
    with transaction() as db:
        if not d.one(db,"SELECT id FROM explorations WHERE id=?",(eid,)): d.fail("Exploración no encontrada")
        question=str(x.get("question") or "").strip()
        if not question: d.fail("La tarjeta necesita una pregunta")
        id=d.uid("card"); db.execute("INSERT INTO cards(id,exploration_id,question,reason,conclusion,status,origin_message_id,created_at,round_id) VALUES (?,?,?,?,?,?,?,?,?)",(id,eid,question,str(x.get("reason") or ""),"","pending",x.get("origin_message_id"),d.now(),x.get("round_id")))
        d.audit(db,"card",id,"created")
        d.index(db,"card",id,str(x.get("question") or ""),str(x.get("reason") or ""))
    return {"id":id}

@app.patch("/api/cards/{id}")
def card_update(id:str,data:Data):
    x=data.obj(); status=x.get("status")
    if status not in {"pending","inferred","confirmed","deferred","discarded"}: d.fail("Estado no válido")
    refresh_round_id=None
    with transaction() as db:
        card=d.one(db,"SELECT * FROM cards WHERE id=?",(id,))
        if not card: d.fail("Tarjeta no encontrada",404)
        conclusion=str(x.get("conclusion",card["conclusion"]))
        if conclusion!=card["conclusion"] or (status in {"pending","deferred","discarded"} and status!=card["status"]):
            d.supersede_pending_proposals(db,card["exploration_id"],id,id,"card")
        db.execute("UPDATE cards SET status=?, conclusion=? WHERE id=?",(status,conclusion,id))
        if status!=card["status"] or conclusion!=card["conclusion"]:
            for linked in rows(db,"SELECT r.id FROM records r JOIN revisions v ON v.record_id=r.id AND v.version=1 WHERE r.kind='decision' AND v.origin_type='card' AND v.origin_id=?",(id,)):
                d.audit(db,"record",linked["id"],"origin_changed","card",id,"La respuesta de origen cambió; revisar la decisión")
                db.execute("UPDATE links SET review_status='needs_update' WHERE (source_type='record' AND source_id=?) OR (target_type='record' AND target_id=?)",(linked["id"],linked["id"]))
        d.index(db,"card",id,card["question"],card["reason"]+" "+conclusion)
        d.audit(db,"card",id,"status_changed",reason=str(x.get("reason") or ""),payload={"previous_status":card["status"],"previous_conclusion":card["conclusion"],"status":status,"conclusion":conclusion})
        if (status!=card["status"] or conclusion!=card["conclusion"]) and card["round_id"]:
            closed=d.one(db,"SELECT id FROM exploration_rounds WHERE id=? AND status='closed'",(card["round_id"],))
            refresh_round_id=closed["id"] if closed else None
        if status=="pending" and card["status"]!="pending":
            db.execute("UPDATE links SET review_status='needs_update' WHERE (source_type='card' AND source_id=?) OR (target_type='card' AND target_id=?)",(id,id))
            for record in rows(db,"SELECT DISTINCT record_id FROM revisions WHERE origin_type='card' AND origin_id=?",(id,)):
                d.audit(db,"record",record["record_id"],"origin_card_reopened","card",id,"Revisar conclusión vinculada")
        d.integrate_cards_if_ready(db,card["exploration_id"])
        if status=="confirmed": project_state.draft_confirmed_card(db,id)
    if refresh_round_id: codex.start_round(refresh_round_id,refresh=True)
    return {"ok":True}

@app.post("/api/records")
def record(data:Data):
    x=data.obj()
    with transaction() as db: id=d.record(db,x,x.get("origin_type","manual"),x.get("origin_id"))
    return {"id":id}

@app.get("/api/records/{id}")
def record_detail(id:str):
    with connect() as db:
        record=d.one(db,"SELECT * FROM records WHERE id=?",(id,))
        if not record: d.fail("Registro no encontrado",404)
        revisions=rows(db,"SELECT * FROM revisions WHERE record_id=? ORDER BY version DESC",(id,))
        return {"record":record,"revisions":revisions,"origins":{str(v["version"]):origin_context(db,v) for v in revisions},"links":rows(db,"SELECT * FROM links WHERE source_id=? OR target_id=?",(id,id)),"criteria":rows(db,"SELECT * FROM criteria WHERE record_id=?",(id,)),"impact":impact_data(db,id)}

def origin_context(db,revision):
    typ=revision["origin_type"]; id=revision["origin_id"]
    if typ=="message" and id:
        msg=d.one(db,"SELECT m.*,e.title AS exploration_title FROM messages m JOIN explorations e ON e.id=m.exploration_id WHERE m.id=?",(id,))
        if not msg: return None
        card=d.one(db,"SELECT question,reason,status FROM cards WHERE id=?",(msg["card_id"],)) if msg["card_id"] else None
        return {"type":typ,"message":msg,"card":card}
    if typ=="card" and id:
        return {"type":typ,"card":d.one(db,"SELECT * FROM cards WHERE id=?",(id,))}
    if typ=="proposal" and id:
        p=d.one(db,"SELECT * FROM proposals WHERE id=?",(id,))
        if not p: return None
        batch=d.one(db,"SELECT * FROM proposal_batches WHERE id=?",(p["batch_id"],))
        source=d.one(db,"SELECT id,name,digest FROM sources WHERE id=?",(batch["source_id"],)) if batch and batch["source_type"]=="source" else None
        message=d.one(db,"SELECT * FROM messages WHERE id=?",(batch["source_id"],)) if batch and batch["source_type"]=="message" else None
        return {"type":typ,"proposal":{**p,"payload":json.loads(p["payload"])},"source":source,"message":message}
    if typ=="source" and id: return {"type":typ,"source":d.one(db,"SELECT id,name,digest FROM sources WHERE id=?",(id,))}
    return {"type":typ}

@app.post("/api/records/{id}/revisions")
def revise(id:str,data:Data):
    with transaction() as db: version=d.revise(db,id,data.obj())
    return {"version":version}

def impact_data(db,id):
    linked=rows(db,"SELECT * FROM links WHERE (source_type='record' AND source_id=?) OR (target_type='record' AND target_id=?)",(id,id))
    ids={id}
    for item in linked:
        if item["source_type"]=="record": ids.add(item["source_id"])
        if item["target_type"]=="record": ids.add(item["target_id"])
    placeholders=",".join("?" for _ in ids)
    params=tuple(ids)
    return {"linked":linked,"criteria":rows(db,f"SELECT * FROM criteria WHERE record_id IN ({placeholders})",params),"tasks":rows(db,f"SELECT DISTINCT t.* FROM tasks t JOIN task_criteria tc ON tc.task_id=t.id JOIN criteria c ON c.id=tc.criterion_id WHERE c.record_id IN ({placeholders})",params),"changesets":rows(db,f"SELECT DISTINCT cs.* FROM changesets cs JOIN changeset_criteria cc ON cc.changeset_id=cs.id JOIN criteria c ON c.id=cc.criterion_id WHERE c.record_id IN ({placeholders})",params)}

@app.get("/api/records/{id}/impact")
def impact(id:str):
    with connect() as db: return impact_data(db,id)

@app.post("/api/links")
def link(data:Data):
    with transaction() as db: id=d.link(db,data.obj())
    return {"id":id}

@app.patch("/api/links/{id}/review")
def review_link(id:str,data:Data):
    status=data.obj().get("review_status")
    if status not in {"current","needs_update","still_valid"}: d.fail("Estado no válido")
    with transaction() as db:
        db.execute("UPDATE links SET review_status=? WHERE id=?",(status,id))
        d.audit(db,"link",id,"reviewed",reason=str(data.obj().get("reason") or ""),payload={"review_status":status})
    return {"ok":True}

@app.post("/api/criteria")
def criterion(data:Data):
    with transaction() as db: id=d.criterion(db,data.obj())
    return {"id":id}

@app.patch("/api/criteria/{id}")
def criterion_update(id:str,data:Data):
    body=str(data.obj().get("body") or "").strip()
    if not body: d.fail("El criterio no puede quedar vacío")
    with transaction() as db:
        item=d.one(db,"SELECT * FROM criteria WHERE id=?",(id,))
        if not item: d.fail("Criterio no encontrado",404)
        if d.one(db,"SELECT task_id FROM task_criteria WHERE criterion_id=? LIMIT 1",(id,)): d.fail("Este criterio ya justifica trabajo; crea otro criterio desde una nueva revisión")
        committed=d.one(db,"SELECT cs.id FROM changesets cs JOIN changeset_criteria cc ON cc.changeset_id=cs.id WHERE cc.criterion_id=? AND cs.status!='draft'",(id,))
        if committed: d.fail("Este criterio pertenece a un alcance aceptado; crea una nueva versión del diseño y otro criterio")
        db.execute("UPDATE criteria SET body=? WHERE id=?",(body,id)); d.index(db,"criterion",id,id,body)
        d.audit(db,"criterion",id,"edited",reason=str(data.obj().get("reason") or ""),payload={"previous_body":item["body"]})
    return {"ok":True}

@app.post("/api/tasks")
def task(data:Data):
    with transaction() as db: id=d.task(db,data.obj())
    return {"id":id}

@app.patch("/api/tasks/{id}")
def task_update(id:str,data:Data):
    x=data.obj(); status=x.get("status")
    if status is not None and status not in {"open","in_progress","done"}: d.fail("Estado no válido")
    with transaction() as db:
        item=d.one(db,"SELECT * FROM tasks WHERE id=?",(id,))
        if not item: d.fail("Tarea no encontrada",404)
        scope=d.one(db,"SELECT cs.status FROM changesets cs JOIN changeset_tasks ct ON ct.changeset_id=cs.id WHERE ct.task_id=? AND cs.status!='draft' ORDER BY CASE WHEN cs.status='result_verified' THEN 0 ELSE 1 END LIMIT 1",(id,))
        if scope and scope["status"]=="result_verified": d.fail("El resultado verificado conserva esta tarea; crea trabajo nuevo para corregirlo")
        if scope and any(key in x for key in ("title","body","area","domain","criterion_ids")): d.fail("Esta tarea pertenece a un alcance aceptado; solo puedes actualizar su estado")
        if item["status"]=="done" and any(key in x for key in ("title","body","area","domain","criterion_ids")): d.fail("Una tarea terminada no cambia su fundamento; crea otra tarea")
        fields={k:str(v) for k,v in x.items() if k in {"title","body","area","domain"}}
        if status is not None: fields["status"]=status
        for key,value in fields.items(): db.execute(f"UPDATE tasks SET {key}=? WHERE id=?",(value,id))
        if "criterion_ids" in x:
            ids=list(dict.fromkeys(x["criterion_ids"]))
            if not ids: d.fail("La tarea necesita al menos un criterio")
            for cid in ids:
                if not d.one(db,"SELECT id FROM criteria WHERE id=?",(cid,)): d.fail("Criterio inexistente")
            db.execute("DELETE FROM task_criteria WHERE task_id=?",(id,))
            for cid in ids: db.execute("INSERT INTO task_criteria VALUES (?,?)",(id,cid))
        d.audit(db,"task",id,"edited",reason=str(x.get("reason") or ""),payload={"previous":item,"changes":x})
    return {"ok":True}

@app.post("/api/changesets")
def changeset(data:Data):
    with transaction() as db: id=d.changeset(db,data.obj())
    return {"id":id}

@app.patch("/api/changesets/{id}")
def changeset_update(id:str,data:Data):
    x=data.obj()
    with transaction() as db:
        item=d.one(db,"SELECT * FROM changesets WHERE id=?",(id,))
        if not item: d.fail("Change Set no encontrado",404)
        if item["status"]!="draft": d.fail("El alcance aceptado no se edita; crea otro Change Set")
        for key in ("title","outcome","reason","included","excluded","dependencies"):
            if key in x: db.execute(f"UPDATE changesets SET {key}=? WHERE id=?",(str(x[key]),id))
        for key,table,column in (("criterion_ids","changeset_criteria","criterion_id"),("task_ids","changeset_tasks","task_id")):
            if key in x:
                db.execute(f"DELETE FROM {table} WHERE changeset_id=?",(id,))
                for value in set(x[key]): db.execute(f"INSERT INTO {table}(changeset_id,{column}) VALUES (?,?)",(id,value))
        if "origin_exploration_ids" in x:
            db.execute("DELETE FROM links WHERE target_type='changeset' AND target_id=? AND relation='origin'",(id,))
            for eid in set(x["origin_exploration_ids"]): d.link(db,{"source_type":"exploration","source_id":eid,"target_type":"changeset","target_id":id,"relation":"origin"})
        d.audit(db,"changeset",id,"edited",reason=str(x.get("reason") or ""),payload=x)
    return {"ok":True}

@app.post("/api/changesets/{id}/accept-scope")
def accept_scope(id:str):
    with transaction() as db: d.accept_scope(db,id)
    return {"ok":True}

@app.get("/api/changesets/{id}")
def changeset_detail(id:str):
    with connect() as db:
        item=d.one(db,"SELECT * FROM changesets WHERE id=?",(id,))
        if not item: d.fail("Change Set no encontrado",404)
        return {"changeset":item,"criteria":rows(db,"SELECT c.* FROM criteria c JOIN changeset_criteria cc ON cc.criterion_id=c.id WHERE cc.changeset_id=?",(id,)),"tasks":rows(db,"SELECT t.* FROM tasks t JOIN changeset_tasks ct ON ct.task_id=t.id WHERE ct.changeset_id=?",(id,)),"origins":rows(db,"SELECT e.id,e.title FROM explorations e JOIN links l ON l.source_id=e.id AND l.source_type='exploration' WHERE l.target_type='changeset' AND l.target_id=? AND l.relation='origin'",(id,)),"audit":rows(db,"SELECT * FROM audit_events WHERE entity_type='changeset' AND entity_id=? ORDER BY created_at DESC",(id,))}

@app.post("/api/changesets/{id}/verify-result")
def verify_result(id:str,data:Data):
    result_ref=str(data.obj().get("result_ref") or "").strip()
    environment=str(data.obj().get("environment") or "").strip()
    if not result_ref or not environment: d.fail("Indica el resultado y el entorno evaluados")
    with transaction() as db:
        item=d.one(db,"SELECT * FROM changesets WHERE id=?",(id,))
        if not item: d.fail("Change Set no encontrado",404)
        if item["status"]!="scope_accepted": d.fail("Primero acepta el alcance")
        incomplete=rows(db,"SELECT t.id FROM tasks t JOIN changeset_tasks ct ON ct.task_id=t.id WHERE ct.changeset_id=? AND t.status!='done'",(id,))
        if incomplete: d.fail("Quedan tareas sin terminar")
        missing=rows(db,"SELECT cc.criterion_id FROM changeset_criteria cc WHERE cc.changeset_id=? AND NOT EXISTS (SELECT 1 FROM evidence e WHERE e.criterion_id=cc.criterion_id AND e.result_ref=? AND e.environment=? AND e.outcome='passed')",(id,result_ref,environment))
        if missing: d.fail("Falta evidencia satisfactoria para: "+", ".join(x["criterion_id"] for x in missing))
        db.execute("UPDATE changesets SET status='result_verified' WHERE id=?",(id,))
        d.audit(db,"changeset",id,"result_verified",reason=str(data.obj().get("reason") or ""),payload={"result_ref":result_ref,"environment":environment})
    return {"ok":True}

@app.post("/api/evidence")
def evidence(data:Data):
    x=data.obj(); cid=x.get("criterion_id")
    with transaction() as db:
        if not d.one(db,"SELECT id FROM criteria WHERE id=?",(cid,)): d.fail("Criterio no encontrado")
        if x.get("task_id") and not d.one(db,"SELECT task_id FROM task_criteria WHERE task_id=? AND criterion_id=?",(x["task_id"],cid)): d.fail("La tarea no cubre este criterio")
        for field in ("result_ref","environment","method","outcome","body"):
            if not str(x.get(field) or "").strip(): d.fail(f"Falta {field}")
        if x["outcome"] not in {"passed","failed"}: d.fail("Resultado de comprobación no válido")
        id=d.uid("ev"); db.execute("INSERT INTO evidence(id,criterion_id,task_id,result_ref,method,outcome,body,created_at,environment,configuration,anomalies) VALUES (?,?,?,?,?,?,?,?,?,?,?)",(id,cid,x.get("task_id"),x["result_ref"],x["method"],x["outcome"],x["body"],d.now(),x["environment"],str(x.get("configuration") or ""),str(x.get("anomalies") or "")))
        d.audit(db,"evidence",id,"created")
    return {"id":id}

@app.get("/api/criteria/{id}/evidence")
def evidence_list(id:str):
    with connect() as db: return rows(db,"SELECT * FROM evidence WHERE criterion_id=? ORDER BY created_at DESC",(id,))

@app.post("/api/import/vision")
def import_vision(data:Data):
    x=data.obj(); content=x.get("content")
    if content is None: content=(ROOT/"VISION.md").read_text(encoding="utf-8")
    with transaction() as db: result=d.import_vision(db,str(x.get("name") or "VISION.md"),content)
    if not result["duplicate"]: result["source_run_id"]=codex.start_source(result["source_id"],content)
    return result

@app.post("/api/sources/{id}/retry")
def retry_source(id:str):
    with connect() as db:
        source=d.one(db,"SELECT content FROM sources WHERE id=?",(id,))
        if not source: d.fail("Fuente no encontrada",404)
    return {"run_id":codex.start_source(id,source["content"])}

@app.patch("/api/proposals/{id}")
def edit_proposal(id:str,data:Data):
    x=data.obj()
    with transaction() as db:
        p=d.one(db,"SELECT * FROM proposals WHERE id=?",(id,))
        if not p or p["status"]!="pending": d.fail("Propuesta pendiente no encontrada",404)
        payload=json.loads(p["payload"]); payload.update({k:v for k,v in x.items() if k in {"title","body","kind","question","reason","decision_id"}})
        kind=payload.get("kind",p["kind"])
        if kind not in {"exploration","card","decision","fdr","adr"}: d.fail("Tipo de propuesta no válido")
        db.execute("UPDATE proposals SET payload=?, kind=? WHERE id=?",(json.dumps(payload,ensure_ascii=False),kind,id))
    return {"ok":True}

@app.post("/api/batches/{id}/resolve")
def resolve_batch(id:str,data:Data):
    choices=data.obj().get("choices") or {}
    with transaction() as db:
        batch=d.one(db,"SELECT * FROM proposal_batches WHERE id=?",(id,))
        if not batch: d.fail("Lote no encontrado",404)
        for proposal_id,choice in choices.items():
            proposal=d.one(db,"SELECT status,batch_id FROM proposals WHERE id=?",(proposal_id,))
            if not proposal or proposal["batch_id"]!=id: d.fail("Propuesta no encontrada en este lote",404)
            if choice not in {"pending","accepted","discarded"}: d.fail("Elección no válida")
            if choice!="pending" and proposal["status"]!="pending": d.fail("La propuesta cambió tras una respuesta posterior. Actualiza la vista antes de decidir.",409)
        created=[]
        for p in rows(db,"SELECT * FROM proposals WHERE batch_id=? AND status='pending'",(id,)):
            choice=choices.get(p["id"],"pending")
            if choice=="pending": continue
            if choice=="accepted":
                x=json.loads(p["payload"])
                if p["kind"]=="exploration":
                    parent=x.get("parent_id")
                    origin=d.one(db,"SELECT id,project_id FROM explorations WHERE id=?",(parent,)) if parent else None
                    if parent and not origin: d.fail("Exploración de origen no encontrada")
                    project_id=origin["project_id"] if origin else d.uid("project")
                    if not origin: db.execute("INSERT INTO projects(id,name,created_at) VALUES (?,?,?)",(project_id,x["title"],d.now()))
                    eid=d.uid("exp"); db.execute("INSERT INTO explorations(id,title,parent_id,source_id,created_at,project_id) VALUES (?,?,?,?,?,?)",(eid,x["title"],parent,x.get("source_id"),d.now(),project_id)); created.append(eid); d.audit(db,"exploration",eid,"created","proposal",p["id"]); d.index(db,"exploration",eid,x["title"],x.get("body") or "")
                elif p["kind"]=="card":
                    eid=x.get("exploration_id")
                    if not eid or not d.one(db,"SELECT id FROM explorations WHERE id=?",(eid,)): d.fail("La tarjeta necesita una exploración existente")
                    cid=d.uid("card"); db.execute("INSERT INTO cards(id,exploration_id,question,reason,conclusion,status,origin_message_id,created_at) VALUES (?,?,?,?,?,?,?,?)",(cid,eid,x["title"],x["body"],"","pending",x.get("origin_message_id"),d.now())); created.append(cid); d.index(db,"card",cid,x["title"],x["body"])
                else: created.append(d.record(db,x,"proposal",p["id"]))
            elif choice!="discarded": d.fail("Elección no válida")
            db.execute("UPDATE proposals SET status=? WHERE id=?",(choice,p["id"]))
            d.audit(db,"proposal",p["id"],choice)
        if not d.one(db,"SELECT id FROM proposals WHERE batch_id=? AND status='pending'",(id,)):
            db.execute("UPDATE proposal_batches SET status='resolved' WHERE id=?",(id,))
    return {"created":created}

@app.get("/api/search")
def search(q:str):
    terms=[part.replace('"','') for part in q.split() if part.replace('"','')]
    if not terms: return []
    expression=" AND ".join('"'+term+'"' for term in terms[:8])
    with connect() as db: return rows(db,"SELECT entity_type,entity_id,title,snippet(search_index,3,'[',']','…',12) AS excerpt FROM search_index WHERE search_index MATCH ? LIMIT 30",(expression,))

@app.get("/api/tasks/{id}/trace")
def trace(id:str):
    with connect() as db:
        task=d.one(db,"SELECT * FROM tasks WHERE id=?",(id,))
        if not task: d.fail("Tarea no encontrada",404)
        criteria=rows(db,"SELECT c.* FROM criteria c JOIN task_criteria tc ON tc.criterion_id=c.id WHERE tc.task_id=?",(id,))
        revisions=[d.one(db,"SELECT r.title,r.kind,v.* FROM revisions v JOIN records r ON r.id=v.record_id WHERE v.record_id=? AND v.version=?",(c["record_id"],c["record_version"])) for c in criteria]
        related={}; design_links=[]
        for criterion in criteria:
            for item in rows(db,"SELECT * FROM links WHERE source_type='record' AND target_type='record' AND ((source_id=? AND source_version=?) OR (target_id=? AND target_version=?))",(criterion["record_id"],criterion["record_version"],criterion["record_id"],criterion["record_version"])):
                design_links.append(item)
                other_id=item["target_id"] if item["source_id"]==criterion["record_id"] else item["source_id"]
                other_version=item["target_version"] if item["source_id"]==criterion["record_id"] else item["source_version"]
                key=(other_id,other_version)
                if key not in related:
                    revision=d.one(db,"SELECT r.title,r.kind,v.* FROM revisions v JOIN records r ON r.id=v.record_id WHERE v.record_id=? AND v.version=?",key)
                    if revision: related[key]={"revision":revision,"origin":origin_context(db,revision)}
        return {"task":task,"criteria":criteria,"revisions":revisions,"origins":[origin_context(db,r) for r in revisions],"related_revisions":list(related.values()),"evidence":rows(db,"SELECT * FROM evidence WHERE task_id=?",(id,)),"links":design_links+rows(db,"SELECT * FROM links WHERE target_id=? OR source_id=?",(id,id))}

@app.get("/api/export")
def export():
    with connect() as db:
        tables=("sources","explorations","cards","messages","exploration_rounds","exploration_observations","records","revisions","criteria","tasks","task_criteria","changesets","changeset_criteria","changeset_tasks","links","evidence","proposal_batches","proposals","ai_runs","ai_events","ai_spans","audit_events")
        return {"format":"demiurgo-1","exported_at":d.now(),"data":{t:rows(db,f"SELECT * FROM {t}") for t in tables}}

@app.get("/api/export/markdown")
def export_markdown():
    with connect() as db: return PlainTextResponse(exporter.markdown(db),media_type="text/markdown; charset=utf-8")

@app.get("/api/export/context")
def export_context():
    with connect() as db: return portable.export_context(db)

@app.post("/api/import/context")
def import_context(data:Data):
    if data.obj().get("format")!="demiurgo-context-1": d.fail("Formato de contexto no válido")
    with transaction() as db: return portable.import_context(db,data.obj())

@app.post("/api/backup")
def backup():
    target=DB_PATH.with_name(DB_PATH.stem+"-backup-"+d.now().replace(":","-").replace("+","_")+".db")
    with connect() as source, sqlite3.connect(target) as dest: source.backup(dest)
    return {"path":str(target)}

@app.get("/api/audit/{entity_type}/{id}")
def audit_history(entity_type:str,id:str):
    with connect() as db: return rows(db,"SELECT * FROM audit_events WHERE entity_type=? AND entity_id=? ORDER BY created_at DESC",(entity_type,id))

@app.get("/{path:path}")
def spa(path:str):
    if path.startswith("api/"): return JSONResponse({"detail":"Endpoint no encontrado"},status_code=404)
    dist=ROOT/"frontend"/"dist"
    target=(dist/path).resolve()
    if target.is_file() and target.is_relative_to(dist.resolve()): return FileResponse(target)
    if (dist/"index.html").exists(): return FileResponse(dist/"index.html")
    return JSONResponse({"message":"Interfaz sin compilar. Ejecute npm run build en frontend."},status_code=404)
