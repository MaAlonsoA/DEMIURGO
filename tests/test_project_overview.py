import json
import time
from fastapi.testclient import TestClient
from app import db, main, domain


def test_confirmed_choice_becomes_one_draft_and_summary_tracks_facts(tmp_path, monkeypatch):
    path=tmp_path/"overview.db"
    monkeypatch.setattr(db,"DB_PATH",path)
    monkeypatch.setattr(main,"DB_PATH",path)
    monkeypatch.setattr(main.codex,"available",lambda:False)
    with TestClient(main.app) as client:
        project=client.post("/api/projects",json={"name":"Producto"}).json()
        eid=project["exploration_id"]
        card=client.post("/api/cards",json={"exploration_id":eid,"question":"¿Elegimos una plataforma abierta o cerrada?","reason":"Fija alcance"}).json()["id"]
        with db.transaction() as connection:
            batch=domain.uid("batch"); proposal=domain.uid("prop")
            connection.execute("INSERT INTO proposal_batches VALUES (?,?,?,?,?)",(batch,"exploration",eid,"pending",domain.now()))
            payload={"kind":"decision","title":"Plataforma abierta","body":"La plataforma abierta permite elegir una plataforma abierta para el producto.","exploration_id":eid}
            connection.execute("INSERT INTO proposals VALUES (?,?,?,?,?,?)",(proposal,batch,"decision",json.dumps(payload),"pending",domain.now()))
        conclusion="Se elige una plataforma abierta para el producto y se conserva como criterio duradero."
        assert client.patch(f"/api/cards/{card}",json={"status":"confirmed","conclusion":conclusion}).status_code==200
        assert client.patch(f"/api/cards/{card}",json={"status":"confirmed","conclusion":conclusion}).status_code==200
        overview=client.get(f"/api/projects/{project['id']}/overview").json()
        assert len(overview["records"])==1
        decision=overview["records"][0]
        assert decision["status"]=="draft" and decision["origin_type"]=="card" and decision["origin_id"]==card
        assert all(p["id"]!=proposal for p in overview["proposals"])
        assert client.post(f"/api/records/{decision['id']}/revisions",json={"title":"Plataforma abierta elegida","body":conclusion,"reason":"Aprobación humana","status":"approved"}).status_code==200
        approved=client.get(f"/api/projects/{project['id']}/overview").json()
        assert approved["records"][0]["status"]=="approved"
        assert approved["records"][0]["title"]=="Plataforma abierta elegida"
        assert [r["status"] for r in approved["records"][0]["revisions"]]==["draft","approved"]
        prompts=[]
        monkeypatch.setattr(main.codex,"available",lambda:True)
        monkeypatch.setattr(main.codex,"_invoke",lambda _id,prompt: (prompts.append(prompt) or {"reply":"Contexto recibido","proposals":[],"observations":[],"questions":[]}))
        other=client.post("/api/explorations",json={"title":"Otra exploración","parent_id":eid}).json()["id"]
        sent=client.post(f"/api/explorations/{other}/messages",json={"body":"Siguiente paso"}).json()
        for _ in range(100):
            run=next(r for r in client.get("/api/state").json()["runs"] if r["id"]==sent["run_id"])
            if run["status"]!="running": break
            time.sleep(.02)
        assert run["status"]=="completed" and '"status": "approved"' in prompts[0]
        assert conclusion in prompts[0]
        approved=client.get(f"/api/projects/{project['id']}/overview").json()
        with db.transaction() as connection:
            sid=domain.uid("summary")
            connection.execute("INSERT INTO project_summaries VALUES (?,?,?,?,?,?,?)",(sid,project["id"],1,"Texto propuesto","pending",approved["facts_hash"],domain.now()))
        assert client.patch(f"/api/projects/{project['id']}/summary/{sid}",json={"body":"Texto corregido","action":"accept"}).status_code==200
        assert client.get(f"/api/projects/{project['id']}/overview").json()["summary"]["body"]=="Texto corregido"
        client.post("/api/cards",json={"exploration_id":eid,"question":"¿Qué sigue?","reason":"Pendiente"})
        assert client.get(f"/api/projects/{project['id']}/overview").json()["summary_outdated"]


def test_model_retries_when_another_exploration_changes_project_facts(tmp_path, monkeypatch):
    path=tmp_path/"concurrent.db"
    monkeypatch.setattr(db,"DB_PATH",path)
    monkeypatch.setattr(main,"DB_PATH",path)
    monkeypatch.setattr(main.codex,"available",lambda:True)
    prompts=[]
    with TestClient(main.app) as client:
        project=client.post("/api/projects",json={"name":"Producto"}).json()
        root=project["exploration_id"]
        line=client.post("/api/explorations",json={"title":"Otra línea","parent_id":root}).json()["id"]
        def invoke(_run_id,prompt):
            prompts.append(prompt)
            if len(prompts)==1:
                with db.transaction() as connection:
                    domain.record(connection,{"exploration_id":line,"kind":"decision","title":"Límite","body":"No incluir pagos","status":"approved"})
            return {"reply":"Respuesta vigente","proposals":[],"observations":[],"questions":[]}
        monkeypatch.setattr(main.codex,"_invoke",invoke)
        response=client.post(f"/api/explorations/{root}/messages",json={"body":"Diseñemos el producto"}).json()
        for _ in range(100):
            run=next(r for r in client.get("/api/state").json()["runs"] if r["id"]==response["run_id"])
            if run["status"]!="running": break
            time.sleep(.02)
        assert run["status"]=="completed"
        assert len(prompts)==2 and "No incluir pagos" in prompts[1]
        assistant=client.get(f"/api/explorations/{root}/messages?thread=main").json()
        assert len([m for m in assistant if m["role"]=="assistant"])==1
