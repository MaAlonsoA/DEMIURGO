import sqlite3

from fastapi.testclient import TestClient

from app import db, main


def test_project_exploration_decision_design_and_new_line(tmp_path, monkeypatch):
    path = tmp_path / "hierarchy.db"
    monkeypatch.setattr(db, "DB_PATH", path)
    monkeypatch.setattr(main, "DB_PATH", path)
    monkeypatch.setattr(main.codex, "available", lambda: False)
    with TestClient(main.app) as client:
        project = client.post("/api/projects", json={"name": "MVP DEMIURGO"}).json()
        first = project["exploration_id"]
        other = client.post("/api/projects", json={"name": "Otro producto"}).json()["exploration_id"]
        decision_response = client.post("/api/records", json={"kind": "decision", "exploration_id": first, "title": "Preguntas por ronda", "body": "La ronda conserva sus preguntas.", "status": "approved"})
        assert decision_response.status_code == 200
        decision = decision_response.json()["id"]
        assert client.post("/api/records", json={"kind": "fdr", "exploration_id": first, "title": "Sin fundamento", "body": "Texto"}).status_code == 400
        assert client.post("/api/records", json={"kind": "adr", "exploration_id": other, "decision_id": decision, "title": "Cruce", "body": "Texto"}).status_code == 400
        design_response = client.post("/api/records", json={"kind": "fdr", "exploration_id": first, "decision_id": decision, "title": "Vista de rondas", "body": "Permite cerrar cada ronda."})
        assert design_response.status_code == 200
        design = design_response.json()["id"]
        assert client.post(f"/api/records/{design}/revisions", json={"body": "Permite cerrar y revisar cada ronda.", "reason": "Añadir revisión", "status": "approved"}).status_code == 200
        line_response = client.post("/api/explorations", json={"title": "Explorar revisiones", "parent_id": first, "origin_record_id": design})
        assert line_response.status_code == 200
        line = line_response.json()["id"]
        assert client.post("/api/explorations", json={"title": "Origen ajeno", "parent_id": other, "origin_record_id": design}).status_code == 400
        state = client.get("/api/state").json()
        assert {r["kind"] for r in state["records"] if r["exploration_id"] == first} == {"decision", "fdr"}
        assert next(e for e in state["explorations"] if e["id"] == line)["origin_record_id"] == design
        assert any(link["relation"] == "design_of" for link in client.get(f"/api/records/{design}").json()["links"])
        assert client.delete(f"/api/projects/{project['id']}").status_code == 200
        assert client.get(f"/api/records/{design}").status_code == 404
        assert client.get(f"/api/records/{decision}").status_code == 404
        assert not any(e["id"] in {first, line} for e in client.get("/api/state").json()["explorations"])
        with sqlite3.connect(path) as check:
            assert check.execute("PRAGMA foreign_key_check").fetchall() == []
