import json
import threading
import time

from fastapi.testclient import TestClient

from app import db, main


def settled(client, run_id):
    for _ in range(500):
        run = client.get(f"/api/runs/{run_id}").json()
        if run["status"] != "running":
            for thread in threading.enumerate():
                if thread.name == f"demiurgo-run-{run_id}": thread.join(timeout=5)
            return run
        time.sleep(.01)
    raise AssertionError("La ejecución no terminó")


def answer(reply, proposals=()):
    return {"reply": reply, "proposals": list(proposals), "questions": [], "observations": [], "card_conclusion": "", "card_reason": ""}


def test_new_answer_supersedes_old_proposal_before_acceptance(tmp_path, monkeypatch):
    path = tmp_path / "superseded.db"
    monkeypatch.setattr(db, "DB_PATH", path)
    monkeypatch.setattr(main, "DB_PATH", path)
    monkeypatch.setattr(main.codex, "available", lambda: True)
    seen = []

    def invoke(_run_id, prompt):
        context = json.loads(prompt.split("Contexto JSON:\n", 1)[1])
        seen.append(context)
        if context["recent_messages"][-1]["body"] == "Primera respuesta":
            return answer("Hay que aclarar el alcance.", [{"kind": "exploration", "title": "Aplicación completa", "body": "Elegir entre aplicación completa y demo."}])
        return answer("La corrección cambia el alcance.", [{"kind": "exploration", "title": "Implementación auditable", "body": "Definir cómo se verifica una implementación gobernada."}])

    monkeypatch.setattr(main.codex, "_invoke", invoke)
    with TestClient(main.app) as client:
        exploration_id = client.post("/api/projects", json={"name": "Producto"}).json()["exploration_id"]
        card_id = client.post("/api/cards", json={"exploration_id": exploration_id, "question": "¿Qué cierra el MVP?"}).json()["id"]
        first = client.post(f"/api/explorations/{exploration_id}/messages", json={"body": "Primera respuesta", "card_id": card_id}).json()
        assert settled(client, first["run_id"])["status"] == "completed"
        old = next(p for p in client.get("/api/state").json()["proposals"] if p["status"] == "pending")

        second = client.post(f"/api/explorations/{exploration_id}/messages", json={"body": "Corrijo: basta una implementación auditable", "card_id": card_id}).json()
        assert settled(client, second["run_id"])["status"] == "completed"
        proposals = client.get("/api/state").json()["proposals"]
        assert next(p for p in proposals if p["id"] == old["id"])["status"] == "superseded"
        assert seen[-1]["existing_lines"]["pending"] == []
        assert seen[-1]["existing_lines"]["superseded"][0]["title"] == "Aplicación completa"
        assert client.post(f"/api/batches/{old['batch_id']}/resolve", json={"choices": {old["id"]: "accepted"}}).status_code == 409
        assert any(event["action"] == "superseded" for event in client.get(f"/api/audit/proposal/{old['id']}").json())
        current = next(p for p in proposals if p["status"] == "pending")
        created = client.post(f"/api/batches/{current['batch_id']}/resolve", json={"choices": {current["id"]: "accepted"}}).json()["created"]
        assert len(created) == 1
        assert len([e for e in client.get("/api/state").json()["explorations"] if e["parent_id"] == exploration_id]) == 1
        assert client.get(f"/api/explorations/{created[0]}/context").json()["origin_review"] is None
        later = client.post(f"/api/explorations/{exploration_id}/messages", json={"body": "Una precisión posterior sobre el alcance", "card_id": card_id}).json()
        assert settled(client, later["run_id"])["status"] == "completed"
        context = client.get(f"/api/explorations/{created[0]}/context").json()
        assert context["origin_review"] == {"latest_text": "Una precisión posterior sobre el alcance"}
        assert any(e["id"] == created[0] for e in client.get("/api/state").json()["explorations"])


def test_round_rechecks_state_and_regenerates_after_acceptance(tmp_path, monkeypatch):
    path = tmp_path / "round_race.db"
    monkeypatch.setattr(db, "DB_PATH", path)
    monkeypatch.setattr(main, "DB_PATH", path)
    monkeypatch.setattr(main.codex, "available", lambda: True)
    first_review_started = threading.Event()
    continue_review = threading.Event()
    contexts = []

    def invoke(_run_id, prompt):
        context = json.loads(prompt.split("Contexto JSON:\n", 1)[1])
        if context.get("mode") == "round_review":
            contexts.append(context)
            if len(contexts) == 1:
                first_review_started.set()
                assert continue_review.wait(timeout=10)
                return answer("Revisión antigua: no hay líneas aceptadas.")
            return answer("Revisión actualizada: ya existe implementación trazable.", [{"kind": "exploration", "title": "Observabilidad", "body": "Definir las evidencias visibles."}])
        return answer("Propongo explorar la implementación.", [{"kind": "exploration", "title": "Implementación trazable", "body": "Definir el alcance verificable."}])

    monkeypatch.setattr(main.codex, "_invoke", invoke)
    with TestClient(main.app) as client:
        exploration_id = client.post("/api/projects", json={"name": "Producto"}).json()["exploration_id"]
        card_id = client.post("/api/cards", json={"exploration_id": exploration_id, "question": "¿Qué debe implementar?"}).json()["id"]
        response = client.post(f"/api/explorations/{exploration_id}/messages", json={"body": "Un agente integrado", "card_id": card_id}).json()
        assert settled(client, response["run_id"])["status"] == "completed"
        proposal = next(p for p in client.get("/api/state").json()["proposals"] if p["status"] == "pending")
        with db.transaction() as connection:
            round_id = main.d.uid("round")
            connection.execute("INSERT INTO exploration_rounds VALUES (?,?,?,'closed',?,?)", (round_id, exploration_id, response["id"], main.d.now(), main.d.now()))
            connection.execute("UPDATE cards SET round_id=? WHERE id=?", (round_id, card_id))

        review = client.post(f"/api/rounds/{round_id}/analyze").json()
        try:
            assert first_review_started.wait(timeout=5)
            accepted = client.post(f"/api/batches/{proposal['batch_id']}/resolve", json={"choices": {proposal["id"]: "accepted"}}).json()
            assert len(accepted["created"]) == 1
        finally:
            continue_review.set()
        assert settled(client, review["run_id"])["status"] == "completed"
        assert len(contexts) == 2
        assert contexts[0]["existing_lines"]["accepted"] == []
        assert contexts[1]["existing_lines"]["accepted"][0]["title"] == "Implementación trazable"
        messages = client.get(f"/api/explorations/{exploration_id}/messages", params={"thread": "main"}).json()
        assert any("Revisión actualizada" in message["body"] for message in messages)
        assert not any("Revisión antigua" in message["body"] for message in messages)
        assert any(event["action"] == "context_changed" for event in client.get(f"/api/audit/run/{review['run_id']}").json())


def test_older_answer_cannot_publish_after_newer_user_message(tmp_path, monkeypatch):
    path = tmp_path / "message_race.db"
    monkeypatch.setattr(db, "DB_PATH", path)
    monkeypatch.setattr(main, "DB_PATH", path)
    monkeypatch.setattr(main.codex, "available", lambda: True)
    first_started = threading.Event()
    finish_first = threading.Event()

    def invoke(_run_id, prompt):
        context = json.loads(prompt.split("Contexto JSON:\n", 1)[1])
        if context["recent_messages"][-1]["body"] == "Respuesta anterior":
            first_started.set()
            assert finish_first.wait(timeout=10)
            return answer("Interpretación antigua", [{"kind": "exploration", "title": "Línea antigua", "body": "Premisa antigua"}])
        return answer("Interpretación vigente")

    monkeypatch.setattr(main.codex, "_invoke", invoke)
    with TestClient(main.app) as client:
        exploration_id = client.post("/api/projects", json={"name": "Producto"}).json()["exploration_id"]
        card_id = client.post("/api/cards", json={"exploration_id": exploration_id, "question": "¿Qué alcance?"}).json()["id"]
        first = client.post(f"/api/explorations/{exploration_id}/messages", json={"body": "Respuesta anterior", "card_id": card_id}).json()
        try:
            assert first_started.wait(timeout=5)
            second = client.post(f"/api/explorations/{exploration_id}/messages", json={"body": "Respuesta corregida", "card_id": card_id}).json()
            assert settled(client, second["run_id"])["status"] == "completed"
        finally:
            finish_first.set()
        assert settled(client, first["run_id"])["status"] == "superseded"
        messages = client.get(f"/api/explorations/{exploration_id}/messages", params={"card_id": card_id}).json()
        assert any(m["body"] == "Interpretación vigente" for m in messages)
        assert not any(m["body"] == "Interpretación antigua" for m in messages)
        assert not client.get("/api/state").json()["proposals"]


def test_new_answer_reopens_review_of_a_closed_round(tmp_path, monkeypatch):
    path = tmp_path / "closed_round.db"
    monkeypatch.setattr(db, "DB_PATH", path)
    monkeypatch.setattr(main, "DB_PATH", path)
    monkeypatch.setattr(main.codex, "available", lambda: True)
    review_contexts = []

    def invoke(_run_id, prompt):
        context = json.loads(prompt.split("Contexto JSON:\n", 1)[1])
        if context.get("mode") == "round_review":
            review_contexts.append(context)
            return answer(f"Revisión {len(review_contexts)}")
        return answer("Respuesta incorporada")

    monkeypatch.setattr(main.codex, "_invoke", invoke)
    with TestClient(main.app) as client:
        exploration_id = client.post("/api/projects", json={"name": "Producto"}).json()["exploration_id"]
        card_id = client.post("/api/cards", json={"exploration_id": exploration_id, "question": "¿Qué alcance?"}).json()["id"]
        first = client.post(f"/api/explorations/{exploration_id}/messages", json={"body": "Primera respuesta", "card_id": card_id}).json()
        assert settled(client, first["run_id"])["status"] == "completed"
        with db.transaction() as connection:
            round_id = main.d.uid("round")
            connection.execute("INSERT INTO exploration_rounds VALUES (?,?,?,'closed',?,?)", (round_id, exploration_id, first["id"], main.d.now(), main.d.now()))
            connection.execute("UPDATE cards SET round_id=? WHERE id=?", (round_id, card_id))
        initial_review = client.post(f"/api/rounds/{round_id}/analyze").json()["run_id"]
        assert settled(client, initial_review)["status"] == "completed"

        second = client.post(f"/api/explorations/{exploration_id}/messages", json={"body": "Corrección posterior", "card_id": card_id}).json()
        assert settled(client, second["run_id"])["status"] == "completed"
        for _ in range(500):
            reviews = [r for r in client.get("/api/state").json()["runs"] if r["round_id"] == round_id]
            if len(reviews) == 2: break
            time.sleep(.01)
        assert len(reviews) == 2
        assert settled(client, reviews[0]["id"])["status"] == "completed"
        assert len(review_contexts) == 2
        assert any(m["body"] == "Corrección posterior" for m in review_contexts[-1]["round"]["cards"][0]["messages"])
