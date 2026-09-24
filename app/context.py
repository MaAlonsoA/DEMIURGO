"""Portable design context without implementation state."""
import json
from .db import rows
from .domain import audit, one, uid, now, link, index

PORTABLE_TYPES={"source","exploration","card","record","criterion"}

def export_context(db):
    accepted=rows(db,"SELECT * FROM proposals WHERE status='accepted'")
    batch_ids={p["batch_id"] for p in accepted}
    batches=[b for b in rows(db,"SELECT * FROM proposal_batches") if b["id"] in batch_ids]
    links=[l for l in rows(db,"SELECT * FROM links") if l["source_type"] in PORTABLE_TYPES and l["target_type"] in PORTABLE_TYPES]
    return {"format":"demiurgo-context-1","exported_at":now(),"projects":rows(db,"SELECT * FROM projects"),"sources":rows(db,"SELECT * FROM sources"),"explorations":rows(db,"SELECT * FROM explorations"),"cards":rows(db,"SELECT * FROM cards"),"messages":rows(db,"SELECT * FROM messages"),"rounds":rows(db,"SELECT * FROM exploration_rounds"),"observations":rows(db,"SELECT * FROM exploration_observations"),"records":rows(db,"SELECT * FROM records"),"revisions":rows(db,"SELECT * FROM revisions"),"criteria":rows(db,"SELECT * FROM criteria"),"proposal_batches":batches,"proposals":accepted,"links":links}

def import_context(db,package):
    if package.get("format")!="demiurgo-context-1": raise ValueError("Formato de contexto no válido")
    mapping={}; created=[]
    for source in package.get("sources",[]):
        existing=one(db,"SELECT id FROM sources WHERE digest=?",(source["digest"],))
        sid=existing["id"] if existing else uid("src")
        mapping[source["id"]]=sid
        if not existing:
            db.execute("INSERT INTO sources VALUES (?,?,?,?,?)",(sid,source["name"],source["digest"],source["content"],source.get("created_at") or now()))
            index(db,"source",sid,source["name"],source["content"])
    original_explorations=package.get("explorations",[])
    by_original_id={exp["id"]:exp for exp in original_explorations}
    exported_projects={project["id"]:project for project in package.get("projects",[])}
    roots={}
    def root_for(exp):
        current=exp; seen=set()
        while current.get("parent_id") in by_original_id and current["parent_id"] not in seen:
            seen.add(current["id"]); current=by_original_id[current["parent_id"]]
        return current
    for exp in original_explorations:
        root=root_for(exp); root_id=root["id"]
        if root_id not in roots:
            old_project=exported_projects.get(root.get("project_id"),{})
            project_id=uid("project"); roots[root_id]=project_id
            db.execute("INSERT INTO projects(id,name,created_at) VALUES (?,?,?)",(project_id,old_project.get("name") or root["title"],old_project.get("created_at") or root.get("created_at") or now()))
    for exp in original_explorations:
        eid=uid("exp"); mapping[exp["id"]]=eid; created.append(eid)
        project_id=roots[root_for(exp)["id"]]
        source_id=mapping.get(exp.get("source_id"))
        db.execute("INSERT INTO explorations(id,title,parent_id,source_id,created_at,project_id) VALUES (?,?,?,?,?,?)",(eid,exp["title"],None,source_id,exp.get("created_at") or now(),project_id))
        index(db,"exploration",eid,exp["title"],"")
    for exp in package.get("explorations",[]):
        if exp.get("parent_id") in mapping: db.execute("UPDATE explorations SET parent_id=? WHERE id=?",(mapping[exp["parent_id"]],mapping[exp["id"]]))
    for card in package.get("cards",[]):
        if card["exploration_id"] not in mapping: continue
        cid=uid("card"); mapping[card["id"]]=cid
        db.execute("INSERT INTO cards(id,exploration_id,question,reason,conclusion,status,origin_message_id,created_at) VALUES (?,?,?,?,?,?,?,?)",(cid,mapping[card["exploration_id"]],card["question"],card.get("reason") or "",card.get("conclusion") or "",card.get("status") or "pending",None,card.get("created_at") or now()))
        index(db,"card",cid,card["question"],(card.get("reason") or "")+" "+(card.get("conclusion") or ""))
    for msg in package.get("messages",[]):
        if msg["exploration_id"] not in mapping: continue
        mid=uid("msg"); mapping[msg["id"]]=mid
        db.execute("INSERT INTO messages(id,exploration_id,card_id,role,body,created_at) VALUES (?,?,?,?,?,?)",(mid,mapping[msg["exploration_id"]],mapping.get(msg.get("card_id")),msg["role"],msg["body"],msg.get("created_at") or now()))
        index(db,"message",mid,"Conversación",msg["body"])
    for round_item in package.get("rounds",[]):
        if round_item.get("exploration_id") not in mapping or round_item.get("source_message_id") not in mapping: continue
        rid=uid("round"); mapping[round_item["id"]]=rid
        db.execute("INSERT INTO exploration_rounds VALUES (?,?,?,?,?,?)",(rid,mapping[round_item["exploration_id"]],mapping[round_item["source_message_id"]],round_item.get("status") or "open",round_item.get("created_at") or now(),round_item.get("closed_at")))
    for card in package.get("cards",[]):
        if card.get("round_id") in mapping and card.get("id") in mapping:
            db.execute("UPDATE cards SET round_id=? WHERE id=?",(mapping[card["round_id"]],mapping[card["id"]]))
    for observation in package.get("observations",[]):
        if observation.get("round_id") not in mapping or observation.get("source_message_id") not in mapping: continue
        db.execute("INSERT INTO exploration_observations VALUES (?,?,?,?,?,?)",(uid("obs"),mapping[observation["round_id"]],mapping[observation["source_message_id"]],observation["kind"],observation["content"],observation.get("created_at") or now()))
    for card in package.get("cards",[]):
        if card["id"] in mapping and card.get("origin_message_id") in mapping:
            db.execute("UPDATE cards SET origin_message_id=? WHERE id=?",(mapping[card["origin_message_id"]],mapping[card["id"]]))
    for batch in package.get("proposal_batches",[]):
        if batch["source_id"] not in mapping: continue
        bid=uid("batch"); mapping[batch["id"]]=bid
        db.execute("INSERT INTO proposal_batches VALUES (?,?,?,?,?)",(bid,batch["source_type"],mapping[batch["source_id"]],"resolved",batch.get("created_at") or now()))
    for proposal in package.get("proposals",[]):
        if proposal["batch_id"] not in mapping: continue
        pid=uid("prop"); mapping[proposal["id"]]=pid
        payload=json.loads(proposal["payload"]) if isinstance(proposal["payload"],str) else proposal["payload"]
        for key in ("source_id","exploration_id","parent_id","origin_message_id"):
            if payload.get(key) in mapping: payload[key]=mapping[payload[key]]
        db.execute("INSERT INTO proposals VALUES (?,?,?,?,?,?)",(pid,mapping[proposal["batch_id"]],proposal["kind"],json.dumps(payload,ensure_ascii=False),"accepted",proposal.get("created_at") or now()))
    for record in package.get("records",[]):
        rid=uid(record["kind"]); mapping[record["id"]]=rid; created.append(rid)
        db.execute("INSERT INTO records(id,kind,title,current_revision,created_at,exploration_id) VALUES (?,?,?,?,?,?)",(rid,record["kind"],record["title"],record.get("current_revision") or 1,record.get("created_at") or now(),mapping.get(record.get("exploration_id"))))
    for exp in original_explorations:
        if exp.get("origin_record_id") in mapping and exp["id"] in mapping:
            db.execute("UPDATE explorations SET origin_record_id=? WHERE id=?",(mapping[exp["origin_record_id"]],mapping[exp["id"]]))
    revisions=package.get("revisions")
    if revisions is None:  # Context exports produced before full history was included.
        revisions=[{"record_id":r["id"],"version":1,"body":r["body"],"reason":r.get("reason") or "Contexto importado","origin_type":"manual","origin_id":None,"created_at":now()} for r in package.get("records",[])]
    for revision in revisions:
        if revision["record_id"] not in mapping: continue
        ot=revision.get("origin_type") or "manual"; oi=revision.get("origin_id")
        if ot!="manual" and oi not in mapping: ot="manual"; oi=None
        else: oi=mapping.get(oi)
        db.execute("INSERT INTO revisions VALUES (?,?,?,?,?,?,?,?)",(mapping[revision["record_id"]],revision["version"],revision["body"],revision.get("reason") or "Contexto importado","draft",ot,oi,revision.get("created_at") or now()))
    for record in package.get("records",[]):
        if record["id"] in mapping:
            current=one(db,"SELECT body FROM revisions WHERE record_id=? AND version=?",(mapping[record["id"]],record.get("current_revision") or 1))
            if current: index(db,record["kind"],mapping[record["id"]],record["title"],current["body"])
    for criterion in package.get("criteria",[]):
        if criterion["record_id"] not in mapping: continue
        cid=uid("ac"); mapping[criterion["id"]]=cid
        db.execute("INSERT INTO criteria VALUES (?,?,?,?,?,?)",(cid,criterion["body"],mapping[criterion["record_id"]],criterion["record_version"],"open",criterion.get("created_at") or now()))
        index(db,"criterion",cid,cid,criterion["body"])
    for item in package.get("links",[]):
        if item["source_type"] not in PORTABLE_TYPES or item["target_type"] not in PORTABLE_TYPES: continue
        if item["source_id"] in mapping and item["target_id"] in mapping:
            payload={**item,"source_id":mapping[item["source_id"]],"target_id":mapping[item["target_id"]]}
            link(db,payload)
    for original,new in mapping.items():
        if new in created: audit(db,"context",new,"imported",reason="Conocimiento transferido",payload={"original_id":original})
    return {"created":created,"imported_context_only":True}
