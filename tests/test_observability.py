import json
import threading
import time
from fastapi.testclient import TestClient
from app import db, main, observability


def wait_run(client, run_id):
    for _ in range(200):
        run = client.get(f"/api/runs/{run_id}").json()
        if run["status"] != "running" and any(s["name"] == "demiurgo.analysis" for s in run["spans"]):
            return run
        time.sleep(.01)
    raise AssertionError("run did not finish")


def test_event_usage_distinct_turns_and_missing_values():
    events = [
        {"type": "turn.started"},
        {"type": "item.started", "item": {"type": "command_execution", "id": "tool-1"}},
        {"type": "item.completed", "item": {"type": "command_execution", "id": "tool-1"}},
        {"type": "turn.completed", "usage": {"input_tokens": 100, "cached_input_tokens": 40, "output_tokens": 30, "reasoning_output_tokens": 10}},
        {"type": "turn.completed", "usage": {"input_tokens": 100, "cached_input_tokens": 40, "output_tokens": 30, "reasoning_output_tokens": 10}},
    ]
    metrics, provenance = observability.summarize_events(events)
    assert (metrics["input_tokens"], metrics["cached_input_tokens"], metrics["output_tokens"], metrics["reasoning_output_tokens"]) == (100, 40, 30, 10)
    assert metrics["turns"] == 1 and metrics["tool_calls"] == 1 and metrics["model_calls"] is None
    empty, _ = observability.summarize_events([{"type": "turn.started"}, {"type": "turn.completed"}])
    assert empty["input_tokens"] is None and empty["turns"] == 1 and empty["tool_calls"] == 0
    assert provenance["input_tokens"] == "codex.turn.completed.usage"


def test_run_details_retry_isolation_restart_and_delete(tmp_path, monkeypatch):
    for thread in threading.enumerate():
        if thread.name.startswith("demiurgo-run-"):
            thread.join(timeout=5)
    path = tmp_path / "workspace.db"
    monkeypatch.setattr(db, "DB_PATH", path)
    monkeypatch.setattr(main, "DB_PATH", path)
    monkeypatch.setattr(main.codex, "available", lambda: True)
    prompts = []
    def analyze(run_id, prompt):
        prompts.append(prompt)
        if '"question":' in prompt:
            return {"reply": "Respuesta de tarjeta", "proposals": []}
        return {"reply": "Respuesta principal", "proposals": [], "questions": [{"question": "¿Quién entra?", "reason": "Acceso"}]}
    monkeypatch.setattr(main.codex, "_invoke", analyze)
    with TestClient(main.app) as client:
        project = client.post("/api/projects", json={"name": "Privado"}).json()
        exp = project["exploration_id"]
        sent = client.post(f"/api/explorations/{exp}/messages", json={"body": "Idea privada"}).json()
        first = wait_run(client, sent["run_id"])
        assert first["status"] == "completed" and '"project"' in first["prompt"]
        assert first["result_json"] and first["traceparent"].startswith("00-"+first["trace_id"]+"-")
        assert len(first["spans"]) >= 4
        card = client.get("/api/state").json()["cards"][0]
        answer = client.post(f"/api/explorations/{exp}/messages", json={"body": "Solo socios", "card_id": card["id"]}).json()
        second = wait_run(client, answer["run_id"])
        assert card["question"] in second["prompt"] and '"project_knowledge"' not in second["prompt"]
        retry = client.post(f"/api/messages/{sent['id']}/retry").json()
        third = wait_run(client, retry["run_id"])
        assert third["attempt"] == 2 and third["trace_id"] != first["trace_id"]
        assert len([m for m in client.get(f"/api/explorations/{exp}/messages").json() if m.get("generated_for_message") == sent["id"]]) == 1
        listing = client.get(f"/api/projects/{project['id']}/runs?limit=2").json()
        assert listing["total"] == 3 and len(listing["items"]) == 2 and "prompt" not in listing["items"][0]
        with db.transaction() as connection:
            connection.execute("UPDATE ai_runs SET status='running' WHERE id=?", (third["id"],))
            connection.execute("INSERT INTO ai_events VALUES (?,?,?,?)", (third["id"], 1, main.d.now(), json.dumps({"type":"turn.started"})))
        main.startup()
        assert client.get(f"/api/runs/{third['id']}").json()["status"] == "interrupted"
        assert client.get(f"/api/runs/{third['id']}/events").json()["total"] == 1
        assert client.delete(f"/api/projects/{project['id']}").status_code == 200
        assert client.get(f"/api/runs/{first['id']}").status_code == 404
        with db.connect() as connection:
            assert connection.execute("SELECT count(*) FROM ai_events").fetchone()[0] == 0
            assert connection.execute("SELECT count(*) FROM ai_spans").fetchone()[0] == 0


def test_shared_source_survives_first_project_and_is_purged_with_last(tmp_path, monkeypatch):
    path = tmp_path / "sources.db"
    monkeypatch.setattr(db, "DB_PATH", path)
    monkeypatch.setattr(main, "DB_PATH", path)
    monkeypatch.setattr(main.codex, "available", lambda: False)
    with TestClient(main.app) as client:
        imported = client.post("/api/import/vision", json={"content": "## 1. Acceso\nSolo socios."}).json()
        source_id = imported["source_id"]
        proposal = next(p for p in client.get("/api/state").json()["proposals"] if p["batch_id"] == imported["batch_id"])
        assert client.patch(f"/api/proposals/{proposal['id']}", json={"kind": "decision", "title": "Acceso", "body": "Solo socios"}).status_code == 200
        accepted = client.post(f"/api/batches/{imported['batch_id']}/resolve", json={"choices": {proposal["id"]: "accepted"}}).json()
        record_id = accepted["created"][0]
        a = client.post("/api/explorations", json={"title": "A", "source_id": source_id}).json()
        b = client.post("/api/explorations", json={"title": "B", "source_id": source_id}).json()
        projects = {e["id"]: e["project_id"] for e in client.get("/api/state").json()["explorations"]}
        assert client.delete(f"/api/projects/{projects[a['id']]}").status_code == 200
        assert client.get(f"/api/sources/{source_id}").status_code == 200
        assert client.get(f"/api/records/{record_id}").status_code == 200
        assert client.delete(f"/api/projects/{projects[b['id']]}").status_code == 200
        assert client.get(f"/api/sources/{source_id}").status_code == 404
        assert client.get(f"/api/records/{record_id}").status_code == 404
