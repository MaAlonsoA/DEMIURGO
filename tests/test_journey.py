import sqlite3
import threading
import time
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app import db, main
from app.restore import restore


@pytest.fixture
def client(tmp_path, monkeypatch):
    path = tmp_path / "workspace.db"
    monkeypatch.setattr(db, "DB_PATH", path)
    monkeypatch.setattr(main, "DB_PATH", path)
    monkeypatch.setattr(main.codex, "available", lambda: False)
    with TestClient(main.app) as c:
        yield c, path
        for thread in threading.enumerate():
            if thread.name.startswith("demiurgo-run-"):
                thread.join(timeout=5)


def post(c, path, data=None):
    response = c.post(path, json=data or {})
    assert response.status_code == 200, response.text
    return response.json()


def test_import_review_revision_trace_backup_and_context(client, tmp_path):
    c, path = client
    vision = "# Visión\n## 1. Usuarios\nSolo socios.\n## 2. Inscripciones\nInmediata."
    imported = post(c, "/api/import/vision", {"content": vision})
    assert not imported["duplicate"]
    assert post(c, "/api/import/vision", {"content": vision})["duplicate"]
    state = c.get("/api/state").json()
    proposals = [p for p in state["proposals"] if p["batch_id"] == imported["batch_id"]]
    assert len(proposals) == 2
    p = proposals[0]
    assert c.patch(f"/api/proposals/{p['id']}", json={"kind": "decision", "title": "Quién se inscribe", "body": "Solo socios"}).status_code == 200
    accepted = post(c, f"/api/batches/{imported['batch_id']}/resolve", {"choices": {p["id"]: "accepted", proposals[1]["id"]: "discarded"}})
    decision = accepted["created"][0]
    detail = c.get(f"/api/records/{decision}").json()
    assert detail["revisions"][0]["origin_type"] == "proposal"
    source = c.get(f"/api/sources/{imported['source_id']}").json()
    assert source["content"] == vision

    exp = post(c, "/api/explorations", {"title": "Actividades abiertas"})["id"]
    msg = post(c, f"/api/explorations/{exp}/messages", {"body": "Queremos invitados"})
    assert msg["run_id"] is not None
    for _ in range(100):
        run = c.get(f"/api/runs/{msg['run_id']}").json()
        if run["status"] != "running": break
        time.sleep(.01)
    assert run["status"] == "failed"
    assert len(c.get(f"/api/explorations/{exp}/messages").json()) == 1
    assert any(hit["entity_type"]=="message" for hit in c.get("/api/search?q=Queremos%20invitados").json())
    revision = post(c, f"/api/records/{decision}/revisions", {"body": "Socios e invitados", "reason": "Actividades abiertas", "origin_type": "message", "origin_id": msg["id"]})
    assert revision["version"] == 2
    assert c.get(f"/api/records/{decision}").json()["revisions"][1]["body"] == "Solo socios"

    fdr = post(c, "/api/records", {"kind": "fdr", "title": "Inscripción inmediata", "body": "Permitir invitados"})["id"]
    post(c, "/api/links", {"source_type": "record", "source_id": decision, "source_version": 1, "target_type": "record", "target_id": fdr, "target_version": 1, "relation": "justifica"})
    ac = post(c, "/api/criteria", {"record_id": fdr, "record_version": 1, "body": "Un invitado con plaza puede inscribirse"})["id"]
    task = post(c, "/api/tasks", {"title": "Admitir invitados", "criterion_ids": [ac]})["id"]
    assert c.patch(f"/api/criteria/{ac}",json={"body":"Regla reescrita"}).status_code == 400
    cs = post(c, "/api/changesets", {"title": "Actividades abiertas", "criterion_ids": [ac], "task_ids": [task]})["id"]
    assert post(c, f"/api/changesets/{cs}/accept-scope")["ok"]
    impact = c.get(f"/api/records/{fdr}/impact").json()
    assert impact["tasks"][0]["id"] == task
    assert c.get(f"/api/records/{decision}/impact").json()["tasks"][0]["id"] == task
    trace = c.get(f"/api/tasks/{task}/trace").json()
    assert trace["revisions"][0]["version"] == 1
    assert trace["related_revisions"][0]["revision"]["record_id"] == decision
    assert trace["related_revisions"][0]["revision"]["version"] == 1
    assert trace["related_revisions"][0]["origin"]["source"]["name"] == "VISION.md"
    assert c.post(f"/api/changesets/{cs}/verify-result", json={"result_ref": "build-1", "environment": "local"}).status_code == 400
    assert c.patch(f"/api/tasks/{task}", json={"status": "done"}).status_code == 200
    assert c.post(f"/api/changesets/{cs}/verify-result", json={"result_ref": "build-1", "environment": "local"}).status_code == 400
    post(c, "/api/evidence", {"criterion_id": ac, "task_id": task, "result_ref": "build-1", "environment": "local", "configuration": "sqlite", "method": "Prueba manual", "outcome": "passed", "body": "Inscripción completada"})
    assert c.post(f"/api/changesets/{cs}/verify-result", json={"result_ref": "build-1", "environment": "staging"}).status_code == 400
    assert post(c, f"/api/changesets/{cs}/verify-result", {"result_ref": "build-1", "environment": "local"})["ok"]
    assert c.patch(f"/api/tasks/{task}",json={"status":"open"}).status_code == 400

    context = c.get("/api/export/context").json()
    assert "tasks" not in context and "evidence" not in context
    assert len(context["revisions"]) == 3
    assert context["sources"][0]["content"] == vision
    markdown = c.get("/api/export/markdown").text
    assert "Solo socios" in markdown and "Socios e invitados" in markdown
    assert "Inscripción inmediata" in markdown
    full = c.get("/api/export").json()
    assert full["data"]["proposals"] and full["data"]["proposal_batches"]
    backup = Path(post(c, "/api/backup")["path"])
    assert backup.exists()
    with sqlite3.connect(backup) as copy:
        assert copy.execute("SELECT count(*) FROM revisions WHERE record_id=?", (decision,)).fetchone()[0] == 2
        assert copy.execute("SELECT count(*) FROM links").fetchone()[0] == 1
    restored=tmp_path / "restored.db"
    restore(backup,restored)
    with sqlite3.connect(restored) as copy:
        assert copy.execute("SELECT count(*) FROM revisions WHERE record_id=?", (decision,)).fetchone()[0] == 2
        assert copy.execute("SELECT count(*) FROM links").fetchone()[0] == 1

    second = tmp_path / "second.db"
    db.DB_PATH = second
    main.DB_PATH = second
    main.startup()
    imported_context = post(c, "/api/import/context", context)
    assert imported_context["imported_context_only"]
    new_state = c.get("/api/state").json()
    assert len(new_state["records"]) == 2
    assert not new_state["tasks"] and not new_state["changesets"]
    new_decision = next(r for r in new_state["records"] if r["kind"] == "decision")
    new_detail = c.get(f"/api/records/{new_decision['id']}").json()
    assert len(new_detail["revisions"]) == 2
    assert new_detail["revisions"][0]["body"] == "Socios e invitados"
    assert new_detail["origins"]["1"]["source"]["name"] == "VISION.md"
    with db.connect() as new_db:
        assert new_db.execute("SELECT count(*) FROM evidence").fetchone()[0] == 0


def test_reject_unjustified_task_and_uncovered_scope(client):
    c, _ = client
    assert c.post("/api/tasks", json={"title": "Sin criterio"}).status_code == 400
    exp=post(c,"/api/explorations",{"title":"Preguntas"})["id"]
    card=post(c,"/api/cards",{"exploration_id":exp,"question":"¿Invitados?"})["id"]
    assert c.patch(f"/api/cards/{card}",json={"status":"deferred"}).status_code == 200
    assert c.post("/api/records",json={"kind":"decision","title":"Invitados","body":"Sí","status":"approved","origin_type":"card","origin_id":card}).status_code == 400
    assert c.patch(f"/api/cards/{card}",json={"status":"confirmed","conclusion":"Invitados solo en actividades abiertas"}).status_code == 200
    linked_decision=post(c,"/api/records",{"kind":"decision","title":"Invitados","body":"Solo en abiertas","status":"approved","origin_type":"card","origin_id":card})["id"]
    assert c.patch(f"/api/cards/{card}",json={"status":"pending"}).status_code == 200
    assert any(event["action"]=="origin_card_reopened" for event in c.get(f"/api/audit/record/{linked_decision}").json())
    assert "Invitados solo en actividades abiertas" in c.get(f"/api/audit/card/{card}").json()[0]["payload"]
    branch=post(c,"/api/explorations",{"title":"Actividades abiertas","parent_id":exp})["id"]
    question=post(c,"/api/cards",{"exploration_id":branch,"question":"¿Hay cupo?"})["id"]
    assert c.patch(f"/api/cards/{question}",json={"status":"deferred"}).status_code == 200
    parent_messages=c.get(f"/api/explorations/{exp}/messages").json()
    assert any("Resultado de la rama" in m["body"] and "pospuestas siguen pendientes" in m["body"] for m in parent_messages)
    assert c.patch(f"/api/cards/{question}",json={"status":"deferred"}).status_code == 200
    assert len(c.get(f"/api/explorations/{exp}/messages").json())==len(parent_messages)
    rid = post(c, "/api/records", {"kind": "fdr", "title": "Catálogo", "body": "Lista de actividades"})["id"]
    empty_cs=post(c,"/api/changesets",{"title":"Vacío"})["id"]
    assert c.post(f"/api/changesets/{empty_cs}/accept-scope").status_code == 400
    ac = post(c, "/api/criteria", {"record_id": rid, "record_version": 1, "body": "Las actividades se muestran"})["id"]
    cs = post(c, "/api/changesets", {"title": "Catálogo", "criterion_ids": [ac]})["id"]
    assert c.post(f"/api/changesets/{cs}/accept-scope").status_code == 400
    assert all(cs["status"] == "draft" for cs in c.get("/api/state").json()["changesets"])
    main.startup()  # A second launch must not try to recreate the schema.


def test_codex_source_proposals_and_failed_message_keep_data(client, monkeypatch):
    c, _ = client
    monkeypatch.setattr(main.codex, "available", lambda: True)
    monkeypatch.setattr(main.codex, "_invoke", lambda run_id, prompt: {"reply": "Revisar invitados", "proposals": [{"kind": "fdr", "title": "Inscripción de invitados", "body": "Admitir invitados con plazas"}]})
    imported = post(c, "/api/import/vision", {"content": "## 1. Inscripciones\nAdmitir invitados."})
    for _ in range(100):
        state = c.get("/api/state").json()
        if state["source_runs"][0]["status"] != "running": break
        time.sleep(.01)
    assert state["source_runs"][0]["status"] == "completed"
    assert any(p["kind"] == "fdr" for p in state["proposals"])

    exp = post(c, "/api/explorations", {"title": "Asociación"})["id"]
    card = post(c, "/api/cards", {"exploration_id": exp, "question": "¿Invitados?", "reason": "Cambio de alcance"})["id"]
    answered = post(c, f"/api/explorations/{exp}/messages", {"body": "Sí, con plazas", "card_id": card})
    # The mocked reply does not infer a conclusion; a second run does.
    for _ in range(100):
        state = c.get("/api/state").json()
        if any(r["id"] == answered["run_id"] and r["status"] != "running" for r in state["runs"]): break
        time.sleep(.01)
    monkeypatch.setattr(main.codex, "_invoke", lambda *_: {"reply": "Hay información suficiente", "proposals": [], "card_conclusion": "Se admiten invitados", "card_reason": "Respuesta explícita"})
    post(c, f"/api/explorations/{exp}/messages", {"body": "Confirmo invitados", "card_id": card})
    for _ in range(100):
        state = c.get("/api/state").json()
        if state["cards"][0]["status"] == "inferred": break
        time.sleep(.01)
    assert state["cards"][0]["status"] == "inferred"
    assert any(m["role"] == "assistant" and m["card_id"] == card for m in c.get(f"/api/explorations/{exp}/messages").json())
    assert c.patch(f"/api/cards/{card}", json={"status": "confirmed"}).status_code == 200
    assert c.get("/api/state").json()["cards"][0]["conclusion"] == "Se admiten invitados"
    assert any("Síntesis de la ronda" in m["body"] for m in c.get(f"/api/explorations/{exp}/messages").json())

    def fail(*_): raise RuntimeError("Fallo simulado")
    monkeypatch.setattr(main.codex, "_invoke", fail)
    message = post(c, f"/api/explorations/{exp}/messages", {"body": "La inscripción es inmediata"})
    assert message["run_id"]
    for _ in range(100):
        state = c.get("/api/state").json()
        if state["runs"][0]["status"] != "running": break
        time.sleep(.01)
    assert state["runs"][0]["status"] == "failed"
    assert any(m["body"] == "La inscripción es inmediata" for m in c.get(f"/api/explorations/{exp}/messages").json())
    assert c.get("/api/state").json()["records"] == []


def test_association_questions_two_related_fdr_and_changeset(client, monkeypatch):
    c, _ = client
    monkeypatch.setattr(main.codex, "available", lambda: True)
    monkeypatch.setattr(main.codex, "_invoke", lambda *_: {"reply": "Hay dos capacidades y una pregunta abierta.", "card_conclusion": "", "card_reason": "", "proposals": [
        {"kind": "card", "title": "¿Todas las actividades admiten invitados?", "body": "Hay que definir el alcance."},
        {"kind": "fdr", "title": "Publicar actividades", "body": "La asociación publica actividades y define plazas."},
        {"kind": "fdr", "title": "Inscripción inmediata", "body": "Los socios se inscriben si hay plazas."},
    ]})
    exp = post(c, "/api/explorations", {"title": "Aplicación de la asociación"})["id"]
    msg = post(c, f"/api/explorations/{exp}/messages", {"body": "Publicar actividades e inscribir socios"})
    for _ in range(100):
        s = c.get("/api/state").json()
        if s["runs"][0]["status"] != "running": break
        time.sleep(.01)
    batch = next(b for b in s["batches"] if b["source_id"] == msg["id"])
    decision = post(c, "/api/records", {"kind": "decision", "title": "Quién se inscribe", "body": "Solo socios", "origin_type": "message", "origin_id": msg["id"], "exploration_id": exp})["id"]
    for proposal in s["proposals"]:
        if proposal["batch_id"] == batch["id"] and proposal["kind"] == "fdr":
            assert c.patch(f"/api/proposals/{proposal['id']}", json={"decision_id": decision}).status_code == 200
    choices = {p["id"]: "accepted" for p in s["proposals"] if p["batch_id"] == batch["id"]}
    post(c, f"/api/batches/{batch['id']}/resolve", {"choices": choices})
    s = c.get("/api/state").json()
    assert len(s["cards"]) == 1
    assert [r["kind"] for r in s["records"]].count("fdr") == 2
    fdrs = [r["id"] for r in s["records"] if r["kind"] == "fdr"]
    for fdr in fdrs:
        post(c, "/api/links", {"source_type": "record", "source_id": decision, "source_version": 1, "target_type": "record", "target_id": fdr, "target_version": 1, "relation": "concreta"})
    criteria = [post(c, "/api/criteria", {"record_id": fdr, "record_version": 1, "body": "Comportamiento observable de " + fdr})["id"] for fdr in fdrs]
    tasks = [post(c, "/api/tasks", {"title": "Implementar " + cid, "criterion_ids": [cid]})["id"] for cid in criteria]
    cs = post(c, "/api/changesets", {"title": "Primera versión de asociación", "criterion_ids": criteria, "task_ids": tasks, "origin_exploration_ids": [exp]})["id"]
    assert post(c, f"/api/changesets/{cs}/accept-scope")["ok"]
    assert len(c.get(f"/api/records/{decision}/impact").json()["tasks"]) == 2
    assert c.get(f"/api/changesets/{cs}").json()["origins"][0]["id"] == exp


def test_exploration_round_branches_isolate_context_and_close_with_open_questions(client, monkeypatch):
    c, _ = client
    monkeypatch.setattr(main.codex, "available", lambda: True)
    prompts=[]
    def analyze(_run_id, prompt):
        prompts.append(prompt)
        if '"question":' in prompt:
            return {"reply":"La respuesta queda registrada.","proposals":[],"card_conclusion":"Hay plazas limitadas.","card_reason":"Respuesta en esta rama."}
        return {"reply":"Hay una hipótesis y dos incógnitas.","proposals":[],"card_conclusion":"","card_reason":"","observations":[{"kind":"claim","content":"Se publicarán actividades."},{"kind":"hypothesis","content":"Puede haber límite de plazas."}],"questions":[{"question":"¿Quién puede inscribirse?","reason":"Define el acceso."},{"question":"¿Cómo se asignan las plazas?","reason":"Define el comportamiento al llenarse."}]}
    monkeypatch.setattr(main.codex, "_invoke", analyze)
    exp=post(c,"/api/explorations",{"title":"Producto"})["id"]
    source=post(c,f"/api/explorations/{exp}/messages",{"body":"Publicar actividades"})
    for _ in range(100):
        state=c.get("/api/state").json()
        if state["runs"] and state["runs"][0]["status"]!="running": break
        time.sleep(.01)
    assert state["runs"][0]["status"]=="completed"
    assert len(state["rounds"])==1 and len(state["cards"])==2
    round_id=state["rounds"][0]["id"]
    first,second=state["cards"]
    retry_run=post(c,f"/api/messages/{source['id']}/retry",{})["run_id"]
    for _ in range(100):
        state=c.get("/api/state").json()
        if next((r for r in state["runs"] if r["id"]==retry_run),{}).get("status")!="running": break
        time.sleep(.01)
    assert len(state["cards"])==2
    assert len(c.get(f"/api/explorations/{exp}/messages?thread=main").json())==2
    post(c,f"/api/explorations/{exp}/messages",{"body":"Respuesta para la primera","card_id":first["id"]})
    for _ in range(100):
        state=c.get("/api/state").json()
        if len(prompts)>1 and state["runs"][0]["status"]!="running": break
        time.sleep(.01)
    assert first["question"] in prompts[-1]
    assert second["question"] not in prompts[-1]
    assert len(c.get(f"/api/explorations/{exp}/messages?card_id={first['id']}").json())==2
    assert c.get(f"/api/explorations/{exp}/messages?card_id={second['id']}").json()==[]
    assert c.get(f"/api/explorations/{exp}/messages?thread=main").json()[0]["id"]==source["id"]
    post(c,f"/api/rounds/{round_id}/close",{})
    post(c,f"/api/rounds/{round_id}/close",{})
    state=c.get("/api/state").json()
    assert len([m for m in c.get(f"/api/explorations/{exp}/messages?thread=main").json() if "Cierre de la ronda" in m["body"]])==1
    closure=post(c,f"/api/rounds/{round_id}/close",{})
    assert closure["ok"]
    detail=c.get(f"/api/rounds/{round_id}").json()
    assert detail["status"]=="closed"
    assert any("sin respuesta, sigue abierta" in m["body"] for m in c.get(f"/api/explorations/{exp}/messages?thread=main").json())
    monkeypatch.setattr(main.codex, "_invoke", lambda *_: {"reply":"Salida incompleta", "questions":[{"question":""}]})
    invalid=post(c,f"/api/explorations/{exp}/messages",{"body":"Salida de prueba inválida"})
    for _ in range(100):
        state=c.get("/api/state").json()
        if next((r for r in state["runs"] if r["id"]==invalid["run_id"]),{}).get("status")!="running": break
        time.sleep(.01)
    assert next(r for r in state["runs"] if r["id"]==invalid["run_id"])["status"]=="failed"
    assert len(state["cards"])==2


def test_cancel_codex_keeps_message_and_discards_late_output(client, monkeypatch):
    c, _ = client
    monkeypatch.setattr(main.codex, "available", lambda: True)
    started=threading.Event(); release=threading.Event()
    def slow(*_):
        started.set(); release.wait(2)
        return {"reply": "Respuesta tardía", "proposals": [{"kind": "decision", "title": "No aceptar", "body": "No debe aparecer"}], "card_conclusion": "", "card_reason": ""}
    monkeypatch.setattr(main.codex, "_invoke", slow)
    exp=post(c,"/api/explorations",{"title":"Cancelación"})["id"]
    sent=post(c,f"/api/explorations/{exp}/messages",{"body":"Mensaje que debe sobrevivir"})
    assert started.wait(1)
    assert post(c,f"/api/runs/{sent['run_id']}/cancel")["ok"]
    release.set()
    for _ in range(100):
        state=c.get("/api/state").json()
        if state["runs"][0]["status"]=="cancelled": break
        time.sleep(.01)
    assert state["runs"][0]["status"]=="cancelled"
    assert [m["body"] for m in c.get(f"/api/explorations/{exp}/messages").json()]==["Mensaje que debe sobrevivir"]
    assert not state["proposals"]
