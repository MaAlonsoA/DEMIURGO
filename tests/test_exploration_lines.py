import json
import threading
import time

from fastapi.testclient import TestClient

from app import db, main


def settled(client, run_id):
    for _ in range(200):
        run = client.get(f"/api/runs/{run_id}").json()
        if run["status"] != "running":
            for thread in threading.enumerate():
                if thread.name == f"demiurgo-run-{run_id}": thread.join(timeout=5)
            return run
        time.sleep(.01)
    raise AssertionError("La ejecución no terminó")


def test_card_can_propose_line_and_closed_round_can_be_reviewed(tmp_path, monkeypatch):
    path = tmp_path / "lines.db"
    monkeypatch.setattr(db, "DB_PATH", path)
    monkeypatch.setattr(main, "DB_PATH", path)
    monkeypatch.setattr(main.codex, "available", lambda: False)
    with TestClient(main.app) as client:
        created = client.post("/api/projects", json={"name": "DEMIURGO"}).json()
        project_id, exploration_id = created["id"], created["exploration_id"]
        initial_message = client.post(f"/api/explorations/{exploration_id}/messages", json={"body": "Visión general y ciclo de exploración."}).json()
        assert settled(client, initial_message["run_id"])["status"] == "failed"
        card_id = client.post("/api/cards", json={"exploration_id": exploration_id, "question": "¿Qué artefactos?", "reason": "Definir los entregables."}).json()["id"]
        card_context = client.get(f"/api/explorations/{exploration_id}/context", params={"card_id": card_id}).json()
        assert card_context["card"]["reason"] == "Definir los entregables."
        assert card_context["card"]["origin_message_id"] is None
        prompts = []

        def invoke(_run_id, prompt):
            prompts.append(prompt)
            if '"mode": "round_review"' in prompt:
                return {"reply": "El tema de artefactos pasa a una exploración propia.", "proposals": [{"kind": "exploration", "title": "Artefactos de diseño", "body": "Definir los documentos y sus criterios."}], "questions": [], "observations": [], "card_conclusion": "", "card_reason": ""}
            return {"reply": "Dejamos el detalle para esa línea.", "proposals": [{"kind": "exploration", "title": "Artefactos de diseño", "body": "Definir documentos y criterios de aceptación."}], "questions": [], "observations": [], "card_conclusion": "El resultado será un paquete construible.", "card_reason": "Respuesta explícita."}

        monkeypatch.setattr(main.codex, "_invoke", invoke)
        monkeypatch.setattr(main.codex, "available", lambda: True)
        message = client.post(f"/api/explorations/{exploration_id}/messages", json={"body": "Eso lo exploraremos en su propia vertical; ahora no.", "card_id": card_id}).json()
        assert settled(client, message["run_id"])["status"] == "completed"
        card_run = client.get(f"/api/runs/{message['run_id']}").json()
        assert (card_run["requested_model"], card_run["reasoning_effort"]) == ("gpt-6-sol", "high")
        assert "Visión general" in prompts[0]
        assert "¿Qué artefactos?" in prompts[0]
        branch_context=json.loads(prompts[0].split("Contexto JSON:\n",1)[1])
        assert branch_context["recent_messages"][-1]["body"] == "Eso lo exploraremos en su propia vertical; ahora no."
        assert "cards" not in branch_context
        state = client.get("/api/state").json()
        card_proposals = [p for p in state["proposals"] if p["kind"] == "exploration"]
        assert len(card_proposals) == 1
        assert json.loads(card_proposals[0]["payload"])["parent_id"] == exploration_id
        round_id = None
        with db.transaction() as connection:
            round_id = main.d.uid("round")
            connection.execute("INSERT INTO exploration_rounds VALUES (?,?,?,'closed',?,?)", (round_id, exploration_id, message["id"], main.d.now(), main.d.now()))
            connection.execute("UPDATE cards SET round_id=? WHERE id=?", (round_id, card_id))
        review = client.post(f"/api/rounds/{round_id}/analyze").json()
        assert settled(client, review["run_id"])["status"] == "completed"
        review_run = client.get(f"/api/runs/{review['run_id']}").json()
        assert (review_run["requested_model"], review_run["reasoning_effort"], review_run["method_version"]) == ("gpt-6-sol", "high", "v6")
        assert '"mode": "round_review"' in prompts[-1]
        review_context=json.loads(prompts[-1].split("Contexto JSON:\n",1)[1])
        assert review_context["existing_lines"]["accepted"] == []
        assert any(line["title"] == "Artefactos de diseño" for line in review_context["existing_lines"]["pending"])
        assert len([p for p in client.get("/api/state").json()["proposals"] if p["kind"] == "exploration"]) == 1
        assert client.post(f"/api/rounds/{round_id}/analyze").json()["run_id"] == review["run_id"]
        with db.transaction() as connection:
            connection.execute("UPDATE ai_runs SET method_version='v2' WHERE id=?", (review["run_id"],))
        updated_review = client.post(f"/api/rounds/{round_id}/analyze").json()["run_id"]
        assert updated_review != review["run_id"]
        assert settled(client, updated_review)["status"] == "completed"
        assert len([p for p in client.get("/api/state").json()["proposals"] if p["kind"] == "exploration"]) == 1
        accepted = client.post(f"/api/batches/{card_proposals[0]['batch_id']}/resolve", json={"choices": {card_proposals[0]["id"]: "accepted"}}).json()
        assert len(accepted["created"]) == 1
        state = client.get("/api/state").json()
        assert any(e["parent_id"] == exploration_id and e["id"] == accepted["created"][0] for e in state["explorations"])
        line_context = client.get(f"/api/explorations/{accepted['created'][0]}/context").json()
        assert line_context["parent"]["id"] == exploration_id
        assert line_context["origin_kind"] == "proposal"
        assert line_context["purpose"] == "Definir documentos y criterios de aceptación."
        runs = client.get(f"/api/projects/{project_id}/runs").json()["items"]
        assert any(r["round_id"] == round_id for r in runs)
        assert client.delete(f"/api/projects/{project_id}").status_code == 200
        assert client.get(f"/api/runs/{review['run_id']}").status_code == 404
    for thread in threading.enumerate():
        if thread.name.startswith("demiurgo-run-"):
            thread.join(timeout=5)


def test_initial_analysis_and_accepted_round_keep_human_context(tmp_path, monkeypatch):
    path = tmp_path / "context.db"
    monkeypatch.setattr(db, "DB_PATH", path)
    monkeypatch.setattr(main, "DB_PATH", path)
    monkeypatch.setattr(main.codex, "available", lambda: True)

    def invoke(_run_id, prompt):
        if '"mode": "round_review"' in prompt:
            return {"reply": "Hay que definir el diseño guiado.", "proposals": [{"kind": "exploration", "title": "Diseño guiado evaluable", "body": "Nace del criterio confirmado; definir qué produce y cómo evaluarlo."}], "questions": [], "observations": [], "card_conclusion": "", "card_reason": ""}
        return {"reply": "Aclaremos el resultado esperado.", "proposals": [], "questions": [{"question": "¿Qué debe demostrar?", "reason": "Determina el alcance del MVP."}], "observations": [], "card_conclusion": "", "card_reason": ""}

    monkeypatch.setattr(main.codex, "_invoke", invoke)
    with TestClient(main.app) as client:
        created = client.post("/api/projects", json={"name": "Producto"}).json()
        exploration_id = created["exploration_id"]
        initial = client.post(f"/api/explorations/{exploration_id}/messages", json={"body": "Diseñar un producto guiado."}).json()
        run = settled(client, initial["run_id"])
        assert (run["requested_model"], run["reasoning_effort"], run["method_version"]) == ("gpt-6-sol", "high", "v6")
        state = client.get("/api/state").json()
        card = state["cards"][0]
        question_context = client.get(f"/api/explorations/{exploration_id}/context", params={"card_id": card["id"]}).json()
        assert question_context["card_origin_text"] == "Diseñar un producto guiado."
        assert question_context["card"]["reason"] == "Determina el alcance del MVP."
        client.patch(f"/api/cards/{card['id']}", json={"status": "confirmed", "conclusion": "Un diseño comprobable."})
        round_id = state["rounds"][0]["id"]
        closed = client.post(f"/api/rounds/{round_id}/close").json()
        assert settled(client, closed["run_id"])["status"] == "completed"
        proposal = next(p for p in client.get("/api/state").json()["proposals"] if p["kind"] == "exploration")
        line_id = client.post(f"/api/batches/{proposal['batch_id']}/resolve", json={"choices": {proposal["id"]: "accepted"}}).json()["created"][0]
        line_context = client.get(f"/api/explorations/{line_id}/context").json()
        assert line_context["purpose"] == "Nace del criterio confirmado; definir qué produce y cómo evaluarlo."
        assert line_context["origin_cards"] == [{"question": "¿Qué debe demostrar?", "conclusion": "Un diseño comprobable."}]
        manual_id = client.post("/api/explorations", json={"title": "Nueva perspectiva", "purpose": "Revisar un cambio de alcance.", "parent_id": exploration_id}).json()["id"]
        manual_context = client.get(f"/api/explorations/{manual_id}/context").json()
        assert manual_context["origin_kind"] == "manual"
        assert manual_context["purpose"] == "Revisar un cambio de alcance."
