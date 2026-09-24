import json
import http.client
import os
import re
import shutil
import subprocess
import tempfile
import threading
import time
from pathlib import Path
from urllib.parse import urlparse
from .db import transaction
from .domain import now, uid, one, audit, index, round_review_context
from . import ai_config, observability as obs
from . import project_state

SCHEMA = json.loads((Path(__file__).resolve().parent.parent/".demiurgo/agents/exploration/schema.json").read_text(encoding="utf-8-sig"))
PROCESSES = {}
LOCK = threading.Lock()
MODEL = "gpt-6-luna"
REASONING_EFFORT = "medium"
STRATEGIC_MODEL = "gpt-6-sol"
STRATEGIC_REASONING_EFFORT = "high"
METHOD_VERSION = "v6"


def _add_usage(previous, current):
    return None if previous is None and current is None else (previous or 0)+(current or 0)


def _exploration_exists(db, parent_id, title):
    normalized=title.strip().casefold()
    if any(row["title"].casefold()==normalized for row in db.execute("SELECT title FROM explorations WHERE parent_id=?",(parent_id,))): return True
    return any(row["title"].casefold()==normalized for row in db.execute("SELECT json_extract(p.payload,'$.title') AS title FROM proposals p WHERE p.kind='exploration' AND p.status='pending' AND json_extract(p.payload,'$.parent_id')=?",(parent_id,)))

def available():
    return os.environ.get("DEMIURGO_DISABLE_CODEX") != "1" and shutil.which("codex") is not None

def start(message_id, context):
    run_id=uid("run")
    with transaction() as db:
        msg=one(db,"SELECT m.exploration_id,m.card_id,e.project_id FROM messages m JOIN explorations e ON e.id=m.exploration_id WHERE m.id=?",(message_id,))
        first_message=msg["card_id"] is None and db.execute("SELECT count(*) FROM messages WHERE exploration_id=? AND card_id IS NULL AND role='user'",(msg["exploration_id"],)).fetchone()[0]==1
        action_key="question_response" if msg["card_id"] else "exploration_initial" if first_message else "exploration_chat"
        scope_type="card" if msg["card_id"] else "exploration"
        scope_id=msg["card_id"] or msg["exploration_id"]
        profile=ai_config.resolve_profile(db,action_key,scope_type,scope_id)
        attempt=db.execute("SELECT count(*) FROM ai_runs WHERE message_id=?",(message_id,)).fetchone()[0]+1
        db.execute("""INSERT INTO ai_runs(id,trace_id,project_id,exploration_id,card_id,message_id,attempt,status,provider,requested_model,requested_base_url,reasoning_effort,agent,agent_version,method_version,started_at,cli_invocations)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",(run_id,"0"*32,msg["project_id"],msg["exploration_id"],msg["card_id"],message_id,attempt,"running",profile["provider"],profile["model"],profile["base_url"],profile["reasoning_effort"],"exploration","4",METHOD_VERSION,now(),0))
    threading.Thread(target=_traced_run,args=(run_id,_run,message_id,context),name=f"demiurgo-run-{run_id}",daemon=True).start()
    return run_id

def start_source(source_id, content):
    run_id=uid("source-run")
    with transaction() as db:
        profile=ai_config.resolve_profile(db,"source_analysis","source",source_id)
        attempt=db.execute("SELECT count(*) FROM ai_runs WHERE source_id=?",(source_id,)).fetchone()[0]+1
        db.execute("""INSERT INTO ai_runs(id,trace_id,source_id,attempt,status,provider,requested_model,requested_base_url,reasoning_effort,agent,agent_version,method_version,started_at,cli_invocations)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",(run_id,"0"*32,source_id,attempt,"running",profile["provider"],profile["model"],profile["base_url"],profile["reasoning_effort"],"source-exploration","1","v1",now(),0))
    threading.Thread(target=_traced_run,args=(run_id,_run_source,source_id,content),name=f"demiurgo-run-{run_id}",daemon=True).start()
    return run_id


def start_round(round_id, refresh=False):
    run_id=uid("round-run")
    with transaction() as db:
        item=one(db,"SELECT r.exploration_id,e.project_id FROM exploration_rounds r JOIN explorations e ON e.id=r.exploration_id WHERE r.id=? AND r.status='closed'",(round_id,))
        if not item: raise ValueError("La ronda debe estar cerrada")
        profile=ai_config.resolve_profile(db,"round_review","exploration",item["exploration_id"])
        previous=one(db,"SELECT id FROM ai_runs WHERE round_id=? AND status='running' ORDER BY started_at DESC LIMIT 1",(round_id,))
        if not previous and not refresh:
            previous=one(db,"SELECT id FROM ai_runs WHERE round_id=? AND status='completed' AND method_version=? AND provider=? AND requested_model=? AND reasoning_effort=? AND requested_base_url=? ORDER BY started_at DESC LIMIT 1",(round_id,METHOD_VERSION,profile["provider"],profile["model"],profile["reasoning_effort"],profile["base_url"]))
        if previous: return previous["id"]
        attempt=db.execute("SELECT count(*) FROM ai_runs WHERE round_id=?",(round_id,)).fetchone()[0]+1
        db.execute("""INSERT INTO ai_runs(id,trace_id,project_id,exploration_id,round_id,attempt,status,provider,requested_model,requested_base_url,reasoning_effort,agent,agent_version,method_version,started_at,cli_invocations)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",(run_id,"0"*32,item["project_id"],item["exploration_id"],round_id,attempt,"running",profile["provider"],profile["model"],profile["base_url"],profile["reasoning_effort"],"round-review","4",METHOD_VERSION,now(),0))
    threading.Thread(target=_traced_run,args=(run_id,_run_round,round_id),name=f"demiurgo-run-{run_id}",daemon=True).start()
    return run_id

def start_summary(project_id):
    run_id=uid("summary-run")
    with transaction() as db:
        project_state.facts(db,project_id)
        previous=one(db,"SELECT id FROM ai_runs WHERE project_id=? AND agent='project-summary' AND status='running'",(project_id,))
        if previous: return previous["id"]
        profile=ai_config.resolve_profile(db,"exploration_chat","exploration",one(db,"SELECT id FROM explorations WHERE project_id=? AND parent_id IS NULL",(project_id,))["id"])
        db.execute("""INSERT INTO ai_runs(id,trace_id,project_id,attempt,status,provider,requested_model,requested_base_url,reasoning_effort,agent,agent_version,method_version,started_at,cli_invocations)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",(run_id,"0"*32,project_id,1,"running",profile["provider"],profile["model"],profile["base_url"],profile["reasoning_effort"],"project-summary","1","v1",now(),0))
    threading.Thread(target=_traced_run,args=(run_id,_run_summary,project_id),name=f"demiurgo-run-{run_id}",daemon=True).start()
    return run_id

def _run_summary(run_id,project_id):
    try:
        for attempt in range(3):
            with transaction() as db:
                if one(db,"SELECT status FROM ai_runs WHERE id=?",(run_id,))["status"]!="running": return
                state=project_state.facts(db,project_id); digest=project_state.fingerprint(state)
            prompt=("Propón una síntesis editorial breve en español del proyecto. Distingue acuerdos humanos, borradores y propuestas; "
                    "no inventes decisiones ni presentes hipótesis como aprobadas. Devuelve el texto en reply y proposals: []. "
                    "Los registros estructurados prevalecen sobre esta síntesis.\n\nContexto JSON:\n"+json.dumps(state,ensure_ascii=False))
            result=_call(run_id,prompt,0)
            body=str(result.get("reply") or "").strip()
            if not body: raise RuntimeError("Síntesis vacía")
            with transaction() as db:
                if one(db,"SELECT status FROM ai_runs WHERE id=?",(run_id,))["status"]!="running": return
                if project_state.fingerprint(project_state.facts(db,project_id))!=digest: continue
                db.execute("UPDATE project_summaries SET status='superseded' WHERE project_id=? AND status='pending'",(project_id,))
                version=db.execute("SELECT COALESCE(MAX(version),0)+1 FROM project_summaries WHERE project_id=?",(project_id,)).fetchone()[0]
                summary_id=uid("summary")
                db.execute("INSERT INTO project_summaries VALUES (?,?,?,?,?,?,?)",(summary_id,project_id,version,body,"pending",digest,now()))
                audit(db,"project_summary",summary_id,"proposed",payload={"version":version,"facts_hash":digest})
                db.execute("UPDATE ai_runs SET status='completed',finished_at=? WHERE id=?",(now(),run_id))
                return
        raise RuntimeError("El proyecto cambió durante la síntesis; vuelve a generarla")
    except Exception as exc:
        with transaction() as db: db.execute("UPDATE ai_runs SET status='failed',error=?,finished_at=? WHERE id=? AND status='running'",(str(exc)[:1200],now(),run_id))
    finally:
        with LOCK: PROCESSES.pop(run_id,None)

def cancel(run_id):
    with LOCK: proc=PROCESSES.get(run_id)
    if proc:
        try:
            proc.terminate() if hasattr(proc,"terminate") else proc.close()
        except OSError:
            pass
    with transaction() as db:
        db.execute("UPDATE ai_runs SET status='cancelled', finished_at=? WHERE id=? AND status='running'",(now(),run_id))

def _invoke(run_id,prompt):
    with transaction() as db:
        run=one(db,"SELECT provider,requested_model,requested_base_url,reasoning_effort FROM ai_runs WHERE id=?",(run_id,))
    if run["provider"]=="qwen":
        return _invoke_qwen(run_id,prompt,run)
    return _invoke_codex(run_id,prompt,run)


def _invoke_codex(run_id,prompt,run):
    if not available(): raise RuntimeError("Codex CLI no está disponible")
    with tempfile.TemporaryDirectory(prefix="demiurgo-codex-") as tmp:
        root=Path(tmp); (root/"schema.json").write_text(json.dumps(SCHEMA),encoding="utf-8")
        model=run["requested_model"]; effort=run["reasoning_effort"]
        env={key:value for key,value in os.environ.items() if not key.startswith("DEMIURGO_")}
        env.setdefault("HOME",str(Path.home()))
        env.setdefault("CODEX_HOME",str(Path.home()/".codex"))
        proc=subprocess.Popen(["codex","exec","--json","--skip-git-repo-check","--ephemeral","--ignore-user-config","--ignore-rules","--model",model,"--config",f'model_reasoning_effort="{effort}"',"--sandbox","read-only","--cd",str(root),"--output-schema",str(root/"schema.json"),"--output-last-message",str(root/"last-message.json"),"-"],cwd=root,env=env,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,encoding="utf-8",bufsize=1)
        with LOCK: PROCESSES[run_id]=proc
        with transaction() as db:
            event_offset=db.execute("SELECT COALESCE(MAX(seq),0) FROM ai_events WHERE run_id=?",(run_id,)).fetchone()[0]
            db.execute("UPDATE ai_runs SET cli_invocations=COALESCE(cli_invocations,0)+1 WHERE id=?",(run_id,))
        proc.stdin.write(prompt); proc.stdin.close()
        err_lines=[]; events=[]
        stderr_thread=threading.Thread(target=lambda: err_lines.extend(proc.stderr.readlines()),daemon=True)
        stderr_thread.start()
        timed_out=False
        def watchdog():
            nonlocal timed_out
            try: proc.wait(timeout=240 if model==STRATEGIC_MODEL else 120)
            except subprocess.TimeoutExpired:
                timed_out=True; proc.kill()
        guard=threading.Thread(target=watchdog,daemon=True); guard.start()
        for line in proc.stdout:
            raw=line.rstrip("\r\n")
            if not raw: continue
            try: event=json.loads(raw)
            except json.JSONDecodeError: event={"type":"invalid_jsonl","raw":raw}
            events.append(event)
            with transaction() as db:
                db.execute("INSERT INTO ai_events(run_id,seq,received_at,raw_json) VALUES (?,?,?,?)",(run_id,event_offset+len(events),now(),raw))
        guard.join(); stderr_thread.join(timeout=1)
        summary,provenance=obs.summarize_events(events)
        with transaction() as db:
            previous=one(db,"SELECT input_tokens,cached_input_tokens,output_tokens,reasoning_output_tokens,turns,tool_calls,model_calls FROM ai_runs WHERE id=?",(run_id,))
            metrics={key:_add_usage(previous[key],summary[key]) for key in ("input_tokens","cached_input_tokens","output_tokens","reasoning_output_tokens","turns","tool_calls","model_calls")}
            db.execute("""UPDATE ai_runs SET input_tokens=?,cached_input_tokens=?,output_tokens=?,reasoning_output_tokens=?,turns=?,tool_calls=?,model_calls=?,observed_model=?,usage_provenance=? WHERE id=?""",(metrics["input_tokens"],metrics["cached_input_tokens"],metrics["output_tokens"],metrics["reasoning_output_tokens"],metrics["turns"],metrics["tool_calls"],metrics["model_calls"],summary["observed_model"],json.dumps(provenance),run_id))
        output=root/"last-message.json"
        raw_result=output.read_text(encoding="utf-8") if output.exists() else ""
        if raw_result:
            with transaction() as db: db.execute("UPDATE ai_runs SET result_json=? WHERE id=?",(raw_result,run_id))
        if timed_out: raise RuntimeError("Codex superó el límite de tiempo de esta ejecución")
        if proc.returncode: raise RuntimeError("Codex terminó con error: "+"".join(err_lines)[-1200:])
        result=json.loads(raw_result)
        if not isinstance(result,dict) or not isinstance(result.get("reply"),str) or not isinstance(result.get("proposals"),list): raise RuntimeError("Respuesta de Codex inválida")
        return result


def _json_object(text):
    text=re.sub(r"```(?:json)?\s*|\s*```","",str(text or ""),flags=re.IGNORECASE).strip()
    decoder=json.JSONDecoder()
    for match in re.finditer(r"\{",text):
        try:
            value,_=decoder.raw_decode(text,match.start())
            if isinstance(value,dict): return value
        except json.JSONDecodeError:
            continue
    return None


def _invoke_qwen(run_id,prompt,run):
    parsed=urlparse(ai_config.normalize_base_url(run["requested_base_url"]))
    connection_type=http.client.HTTPSConnection if parsed.scheme=="https" else http.client.HTTPConnection
    connection=connection_type(parsed.hostname,parsed.port,timeout=300)
    endpoint=parsed.path.rstrip("/")+"/chat/completions"
    schema_instruction="Devuelve exclusivamente un objeto JSON válido, sin markdown ni texto adicional, conforme a este esquema:\n"+json.dumps(SCHEMA,ensure_ascii=False)
    messages=[{"role":"system","content":schema_instruction},{"role":"user","content":prompt}]
    totals={"input_tokens":0,"cached_input_tokens":0,"output_tokens":0,"reasoning_output_tokens":0}
    reported={key:False for key in totals}
    provenance={"input_tokens":"qwen.chat_completions.usage.prompt_tokens","cached_input_tokens":"qwen.chat_completions.usage.prompt_tokens_details.cached_tokens","output_tokens":"qwen.chat_completions.usage.completion_tokens","reasoning_output_tokens":"qwen.chat_completions.usage.completion_tokens_details.reasoning_tokens"}
    observed_model=run["requested_model"]
    with transaction() as db:
        event_offset=db.execute("SELECT COALESCE(MAX(seq),0) FROM ai_events WHERE run_id=?",(run_id,)).fetchone()[0]
    try:
        for attempt in range(2):
            payload={"model":run["requested_model"],"messages":messages,"reasoning_effort":run["reasoning_effort"],"temperature":0,"max_tokens":8192}
            body=json.dumps(payload,ensure_ascii=False).encode("utf-8")
            with LOCK: PROCESSES[run_id]=connection
            connection.request("POST",endpoint,body=body,headers={"Content-Type":"application/json","Accept":"application/json"})
            response=connection.getresponse()
            raw=response.read().decode("utf-8","replace")
            if response.status>=300:
                try: detail=json.loads(raw).get("error",{}).get("message",raw)
                except (json.JSONDecodeError,AttributeError): detail=raw
                raise RuntimeError(f"Qwen respondió HTTP {response.status}: {str(detail)[:1000]}")
            completion=json.loads(raw)
            observed_model=completion.get("model") or observed_model
            choice=(completion.get("choices") or [{}])[0]
            answer=choice.get("message") or {}
            content=answer.get("content")
            if isinstance(content,list): content="".join(str(part.get("text") or "") for part in content if isinstance(part,dict))
            result=_json_object(content)
            usage=completion.get("usage") or {}
            prompt_details=usage.get("prompt_tokens_details") or {}
            completion_details=usage.get("completion_tokens_details") or {}
            fields=(("input_tokens",usage.get("prompt_tokens")),("cached_input_tokens",prompt_details.get("cached_tokens",usage.get("cached_tokens"))), ("output_tokens",usage.get("completion_tokens")),("reasoning_output_tokens",completion_details.get("reasoning_tokens")))
            for key,value in fields:
                if isinstance(value,int):
                    totals[key]+=value
                    reported[key]=True
            event={"type":"local_model.completed","provider":"qwen","model":observed_model,"attempt":attempt+1,"usage":usage}
            with transaction() as db:
                db.execute("INSERT INTO ai_events(run_id,seq,received_at,raw_json) VALUES (?,?,?,?)",(run_id,event_offset+attempt+1,now(),json.dumps(event,ensure_ascii=False)))
            if result is not None: break
            if attempt==0:
                messages.extend([{"role":"assistant","content":str(content or "")[:6000]},{"role":"user","content":"La salida anterior no era JSON válido. Revisa el esquema y devuelve únicamente el objeto JSON completo, sin explicación ni etiquetas."}])
        if result is None: raise RuntimeError("Qwen no devolvió un objeto JSON válido tras dos intentos.")
        if not isinstance(result.get("reply"),str) or not isinstance(result.get("proposals"),list): raise RuntimeError("La respuesta JSON de Qwen no incluye reply y proposals válidos.")
        values={key:value if reported[key] else None for key,value in totals.items()}
        values.update({"turns":attempt+1,"tool_calls":0,"model_calls":attempt+1,"observed_model":observed_model})
        provenance.update({"turns":"qwen.chat_completions.requests","tool_calls":"demiurgo.provider","model_calls":"qwen.chat_completions.requests","cli_invocations":"not_applicable"})
        with transaction() as db:
            previous=one(db,"SELECT input_tokens,cached_input_tokens,output_tokens,reasoning_output_tokens,turns,tool_calls,model_calls FROM ai_runs WHERE id=?",(run_id,))
            metrics={key:_add_usage(previous[key],values[key]) for key in ("input_tokens","cached_input_tokens","output_tokens","reasoning_output_tokens","turns","tool_calls","model_calls")}
            db.execute("UPDATE ai_runs SET input_tokens=?,cached_input_tokens=?,output_tokens=?,reasoning_output_tokens=?,turns=?,tool_calls=?,model_calls=?,observed_model=?,usage_provenance=?,cli_invocations=0 WHERE id=?",(metrics["input_tokens"],metrics["cached_input_tokens"],metrics["output_tokens"],metrics["reasoning_output_tokens"],metrics["turns"],metrics["tool_calls"],metrics["model_calls"],values["observed_model"],json.dumps(provenance),run_id))
        return result
    finally:
        connection.close()
        with LOCK:
            if PROCESSES.get(run_id) is connection: PROCESSES.pop(run_id,None)


def _traced_run(run_id, fn, *args):
    with transaction() as db: run=one(db,"SELECT provider,requested_model FROM ai_runs WHERE id=?",(run_id,))
    with obs.tracer.start_as_current_span("demiurgo.analysis", attributes={"demiurgo.run_id":run_id,"gen_ai.operation.name":"invoke_agent","gen_ai.request.model":run["requested_model"],"gen_ai.provider.name":run["provider"]}) as span:
        trace_id=f"{span.get_span_context().trace_id:032x}"
        with transaction() as db:
            db.execute("UPDATE ai_runs SET trace_id=?,traceparent=? WHERE id=?",(trace_id,obs.traceparent(),run_id))
        fn(run_id,*args)
        with transaction() as db:
            run=one(db,"SELECT status,input_tokens,cached_input_tokens,output_tokens,reasoning_output_tokens,observed_model FROM ai_runs WHERE id=?",(run_id,))
        if run:
            for key,value in obs.usage_attributes(run).items(): span.set_attribute(key,value)
            if run["status"]!="completed": span.set_attribute("demiurgo.status",run["status"])


def _call(run_id,prompt,context_ms):
    obs.measured_phase(run_id,"demiurgo.context",context_ms)
    with transaction() as db:
        db.execute("UPDATE ai_runs SET prompt=?,context_ms=COALESCE(context_ms,0)+? WHERE id=?",(prompt,context_ms,run_id))
    started=time.perf_counter()
    try:
        with transaction() as db: run=one(db,"SELECT provider,requested_model FROM ai_runs WHERE id=?",(run_id,))
        with obs.tracer.start_as_current_span("ai.provider.invoke", attributes={"demiurgo.run_id":run_id,"gen_ai.operation.name":"invoke_agent","gen_ai.request.model":run["requested_model"],"gen_ai.provider.name":run["provider"]}):
            result=_invoke(run_id,prompt)
        with transaction() as db:
            db.execute("UPDATE ai_runs SET result_json=? WHERE id=?",(json.dumps(result,ensure_ascii=False),run_id))
        return result
    finally:
        with transaction() as db:
            db.execute("UPDATE ai_runs SET invocation_ms=COALESCE(invocation_ms,0)+? WHERE id=?",(round((time.perf_counter()-started)*1000),run_id))

def _run_source(run_id,source_id,content):
    try:
        context_started=time.perf_counter()
        prompt="Descompón esta visión de producto en propuestas revisables. Identifica exploraciones, decisiones de producto duraderas y FDR por capacidades coherentes. Comprueba que las propuestas cubran la capacidad principal de la primera etapa y no solo mecanismos secundarios; no aumentes el número de propuestas sin una incógnita distinta. Explica en cada propuesta su origen y qué falta resolver. Crea ADR solo ante una elección de arquitectura relevante. No supongas que las hipótesis están confirmadas ni resuelvas por inferencia tensiones de alcance. Máximo 15 propuestas; sé concreto. Deja card_conclusion y card_reason vacíos. Devuelve JSON conforme al esquema. Documento:\n"+content
        result=_call(run_id,prompt,round((time.perf_counter()-context_started)*1000))
        validation_started=time.perf_counter()
        if not isinstance(result,dict) or not isinstance(result.get("reply"),str) or not result["reply"].strip(): raise RuntimeError("Respuesta de exploracion invalida")
        result.setdefault("proposals",[]); result.setdefault("observations",[]); result.setdefault("questions",[])
        if not isinstance(result["proposals"],list) or not isinstance(result["observations"],list) or not isinstance(result["questions"],list): raise RuntimeError("Listas de respuesta invalidas")
        if not all(isinstance(x,dict) and x.get("kind") in {"claim","hypothesis","unknown"} and isinstance(x.get("content"),str) and x["content"].strip() for x in result["observations"]): raise RuntimeError("Observaciones invalidas")
        if not all(isinstance(x,dict) and isinstance(x.get("question"),str) and x["question"].strip() and isinstance(x.get("reason"),str) for x in result["questions"]): raise RuntimeError("Preguntas invalidas")
        validation_ms=round((time.perf_counter()-validation_started)*1000)
        obs.measured_phase(run_id,"demiurgo.validation",validation_ms)
        with transaction() as db: db.execute("UPDATE ai_runs SET validation_ms=? WHERE id=?",(validation_ms,run_id))
        persistence_started=time.perf_counter()
        with transaction() as db:
            if one(db,"SELECT status FROM ai_runs WHERE id=?",(run_id,))["status"]!="running": return
            bid=uid("batch")
            db.execute("INSERT INTO proposal_batches VALUES (?,?,?,?,?)",(bid,"source",source_id,"pending",now()))
            for item in result["proposals"][:15]:
                if not isinstance(item,dict) or item.get("kind") not in {"exploration","decision","fdr","adr"}: continue
                title=str(item.get("title") or "").strip(); body=str(item.get("body") or "").strip()
                if not title or not body: continue
                payload={"kind":item["kind"],"title":title,"body":body,"source_id":source_id}
                db.execute("INSERT INTO proposals VALUES (?,?,?,?,?,?)",(uid("prop"),bid,item["kind"],json.dumps(payload,ensure_ascii=False),"pending",now()))
            db.execute("UPDATE ai_runs SET status='completed', finished_at=? WHERE id=?",(now(),run_id))
        persistence_ms=round((time.perf_counter()-persistence_started)*1000)
        obs.measured_phase(run_id,"demiurgo.persistence",persistence_ms)
        with transaction() as db: db.execute("UPDATE ai_runs SET persistence_ms=? WHERE id=?",(persistence_ms,run_id))
    except Exception as exc:
        with transaction() as db:
            db.execute("UPDATE ai_runs SET status='failed', error=?, finished_at=? WHERE id=? AND status='running'",(str(exc)[:1200],now(),run_id))
    finally:
        with LOCK: PROCESSES.pop(run_id,None)

def _run(run_id,message_id,context):
    try:
        method=(Path(__file__).resolve().parent.parent/f".demiurgo/agents/exploration/{METHOD_VERSION}.md").read_text(encoding="utf-8")
        for context_attempt in range(3):
            context_started=time.perf_counter()
            with transaction() as db:
                project_id=one(db,"SELECT e.project_id FROM messages m JOIN explorations e ON e.id=m.exploration_id WHERE m.id=?",(message_id,))["project_id"]
                shared=project_state.facts(db,project_id); digest=project_state.fingerprint(shared)
            scoped=dict(shared)
            if context.get("card") or context.get("message",{}).get("card_id"):
                active_card=(context.get("card") or {}).get("id") or context["message"]["card_id"]
                scoped["cards"]=[card for card in shared["cards"] if card["status"]=="confirmed" or card["id"]==active_card]
            context["project_state"]=scoped
            with transaction() as db:
                editorial=one(db,"SELECT version,body,facts_hash FROM project_summaries WHERE project_id=? AND status='accepted' ORDER BY version DESC LIMIT 1",(project_id,))
            context["editorial_summary"]={**editorial,"outdated":editorial["facts_hash"]!=digest} if editorial else None
            prompt=method+"\n\nContexto JSON:\n"+json.dumps(context,ensure_ascii=False)
            result=_call(run_id,prompt,round((time.perf_counter()-context_started)*1000))
            with transaction() as db:
                if project_state.fingerprint(project_state.facts(db,project_id))==digest: break
                audit(db,"run",run_id,"context_changed",reason="Estado del proyecto modificado durante la respuesta",payload={"attempt":context_attempt+1})
        else: raise RuntimeError("El proyecto cambió varias veces durante el análisis; reintenta la respuesta")
        validation_started=time.perf_counter()
        if not isinstance(result,dict) or not isinstance(result.get("reply"),str) or not result["reply"].strip(): raise RuntimeError("Respuesta de exploracion invalida")
        result.setdefault("proposals",[]); result.setdefault("observations",[]); result.setdefault("questions",[])
        if not isinstance(result["proposals"],list) or not isinstance(result["observations"],list) or not isinstance(result["questions"],list): raise RuntimeError("Listas de respuesta invalidas")
        if not all(isinstance(x,dict) and x.get("kind") in {"claim","hypothesis","unknown"} and isinstance(x.get("content"),str) and x["content"].strip() for x in result["observations"]): raise RuntimeError("Observaciones invalidas")
        if not all(isinstance(x,dict) and isinstance(x.get("question"),str) and x["question"].strip() and isinstance(x.get("reason"),str) for x in result["questions"]): raise RuntimeError("Preguntas invalidas")
        validation_ms=round((time.perf_counter()-validation_started)*1000)
        obs.measured_phase(run_id,"demiurgo.validation",validation_ms)
        with transaction() as db: db.execute("UPDATE ai_runs SET validation_ms=? WHERE id=?",(validation_ms,run_id))
        persistence_started=time.perf_counter()
        with transaction() as db:
            if one(db,"SELECT status FROM ai_runs WHERE id=?",(run_id,))["status"]!="running": return
            if project_state.fingerprint(project_state.facts(db,project_id))!=digest:
                db.execute("UPDATE ai_runs SET status='superseded',error=?,finished_at=? WHERE id=?",("El contexto del proyecto cambió antes de publicar; reintenta",now(),run_id))
                return
            msg=one(db,"SELECT exploration_id,card_id FROM messages WHERE id=?",(message_id,))
            latest=one(db,"SELECT id FROM messages WHERE exploration_id=? AND card_id IS ? AND role='user' ORDER BY created_at DESC,id DESC LIMIT 1",(msg["exploration_id"],msg["card_id"]))
            if latest["id"]!=message_id:
                db.execute("UPDATE ai_runs SET status='superseded',error=?,finished_at=? WHERE id=?",("Llegó una respuesta posterior en esta conversación",now(),run_id))
                return
            if one(db,"SELECT id FROM messages WHERE generated_for_message=?",(message_id,)):
                db.execute("UPDATE ai_runs SET status='completed', finished_at=? WHERE id=?",(now(),run_id)); return
            assistant_id=uid("msg")
            db.execute("INSERT INTO messages(id,exploration_id,card_id,role,body,created_at,generated_for_message) VALUES (?,?,?,?,?,?,?)",(assistant_id,msg["exploration_id"],msg["card_id"],"assistant",result["reply"],now(),message_id))
            index(db,"message",assistant_id,"Analisis de DEMIURGO",result["reply"])
            if result["proposals"]:
                batch_id=None
                for item in result["proposals"][:15]:
                    if not isinstance(item,dict) or item.get("kind") not in {"exploration","card","decision","fdr","adr"} or not isinstance(item.get("title"),str) or not isinstance(item.get("body"),str) or not item["title"].strip() or not item["body"].strip(): raise RuntimeError("Propuesta invalida")
                    if msg["card_id"] is not None and item["kind"]!="exploration": raise RuntimeError("Una rama solo puede proponer nuevas exploraciones")
                    if item["kind"]=="exploration" and _exploration_exists(db,msg["exploration_id"],item["title"]): continue
                    if batch_id is None:
                        batch_id=uid("batch")
                        db.execute("INSERT INTO proposal_batches VALUES (?,?,?,?,?)",(batch_id,"message",message_id,"pending",now()))
                    payload={"kind":item["kind"],"title":item["title"].strip(),"body":item["body"].strip(),"exploration_id":msg["exploration_id"],"parent_id":msg["exploration_id"],"origin_message_id":message_id}
                    db.execute("INSERT INTO proposals VALUES (?,?,?,?,?,?)",(uid("prop"),batch_id,item["kind"],json.dumps(payload,ensure_ascii=False),"pending",now()))
            if msg["card_id"] is None and result["questions"]:
                round_id=uid("round")
                db.execute("INSERT INTO exploration_rounds VALUES (?,?,?,'open',?,NULL)",(round_id,msg["exploration_id"],message_id,now()))
                for item in result["questions"]:
                    card_id=uid("card"); question=item["question"].strip(); reason=item["reason"].strip()
                    db.execute("INSERT INTO cards(id,exploration_id,question,reason,conclusion,status,origin_message_id,created_at,round_id) VALUES (?,?,?,?,?,'pending',?,?,?)",(card_id,msg["exploration_id"],question,reason,"",message_id,now(),round_id))
                    index(db,"card",card_id,question,reason); audit(db,"card",card_id,"created","message",message_id,reason,{"round_id":round_id})
                for observation in result["observations"]:
                    db.execute("INSERT OR IGNORE INTO exploration_observations VALUES (?,?,?,?,?,?)",(uid("obs"),round_id,message_id,observation["kind"],observation["content"].strip(),now()))
                audit(db,"round",round_id,"created","message",message_id,payload={"card_count":len(result["questions"])})
            if msg["card_id"] and str(result.get("card_conclusion") or "").strip():
                previous=one(db,"SELECT status,conclusion FROM cards WHERE id=?",(msg["card_id"],))
                if previous["status"] in {"pending","inferred"}:
                    db.execute("UPDATE cards SET status='inferred', conclusion=? WHERE id=?",(result["card_conclusion"].strip(),msg["card_id"]))
                    audit(db,"card",msg["card_id"],"inferred","message",message_id,str(result.get("card_reason") or ""),{"previous_status":previous["status"],"previous_conclusion":previous["conclusion"],"conclusion":result["card_conclusion"].strip()})
                    card=one(db,"SELECT question,reason FROM cards WHERE id=?",(msg["card_id"],))
                    index(db,"card",msg["card_id"],card["question"],card["reason"]+" "+result["card_conclusion"].strip())
            db.execute("UPDATE ai_runs SET status='completed', finished_at=? WHERE id=?",(now(),run_id))
        persistence_ms=round((time.perf_counter()-persistence_started)*1000)
        obs.measured_phase(run_id,"demiurgo.persistence",persistence_ms)
        with transaction() as db: db.execute("UPDATE ai_runs SET persistence_ms=? WHERE id=?",(persistence_ms,run_id))
        if msg["card_id"]:
            with transaction() as db:
                closed_round=one(db,"SELECT r.id FROM cards c JOIN exploration_rounds r ON r.id=c.round_id WHERE c.id=? AND r.status='closed'",(msg["card_id"],))
            if closed_round: start_round(closed_round["id"],refresh=True)
    except Exception as exc:
        with transaction() as db:
            db.execute("UPDATE ai_runs SET status='failed', error=?, finished_at=? WHERE id=? AND status='running'",(str(exc)[:1200],now(),run_id))
    finally:
        with LOCK: PROCESSES.pop(run_id,None)


def _run_round(run_id,round_id):
    try:
        method=(Path(__file__).resolve().parent.parent/f".demiurgo/agents/exploration/{METHOD_VERSION}.md").read_text(encoding="utf-8")
        for review_attempt in range(3):
            context_started=time.perf_counter()
            with transaction() as db:
                if one(db,"SELECT status FROM ai_runs WHERE id=?",(run_id,))["status"]!="running": return
                context=round_review_context(db,round_id)
            prompt=method+"\n\nModo: revisi\u00f3n de ronda cerrada. Identifica l\u00edneas concretas a partir de las respuestas vigentes. Las conclusiones humanas posteriores prevalecen sobre observaciones iniciales. Revisa las l\u00edneas aceptadas y pendientes que figuran en este contexto; no repitas una pregunta resuelta. Devuelve propuestas de tipo exploration vinculadas a la exploraci\u00f3n actual.\n\nContexto JSON:\n"+json.dumps(context,ensure_ascii=False)
            result=_call(run_id,prompt,round((time.perf_counter()-context_started)*1000))
            validation_started=time.perf_counter()
            if not isinstance(result,dict) or not isinstance(result.get("reply"),str) or not result["reply"].strip() or not isinstance(result.get("proposals"),list): raise RuntimeError("Revisi\u00f3n de ronda inv\u00e1lida")
            proposals=result["proposals"][:15]
            if any(not isinstance(p,dict) or p.get("kind")!="exploration" or not str(p.get("title") or "").strip() or not str(p.get("body") or "").strip() for p in proposals): raise RuntimeError("L\u00ednea de exploraci\u00f3n inv\u00e1lida")
            validation_ms=round((time.perf_counter()-validation_started)*1000)
            obs.measured_phase(run_id,"demiurgo.validation",validation_ms)
            with transaction() as db: db.execute("UPDATE ai_runs SET validation_ms=COALESCE(validation_ms,0)+? WHERE id=?",(validation_ms,run_id))
            persistence_started=time.perf_counter()
            with transaction() as db:
                if one(db,"SELECT status FROM ai_runs WHERE id=?",(run_id,))["status"]!="running": return
                if round_review_context(db,round_id)!=context:
                    audit(db,"run",run_id,"context_changed","round",round_id,"El estado cambi\u00f3 durante la revisi\u00f3n; se genera una s\u00edntesis nueva",{"attempt":review_attempt+1})
                    continue
                round_item=one(db,"SELECT exploration_id,source_message_id FROM exploration_rounds WHERE id=?",(round_id,))
                if proposals:
                    batch_id=None
                    for item in proposals:
                        if _exploration_exists(db,round_item["exploration_id"],item["title"]): continue
                        if batch_id is None:
                            batch_id=uid("batch")
                            db.execute("INSERT INTO proposal_batches VALUES (?,?,?,?,?)",(batch_id,"round",round_id,"pending",now()))
                        payload={"kind":"exploration","title":item["title"].strip(),"body":item["body"].strip(),"parent_id":round_item["exploration_id"],"origin_message_id":round_item["source_message_id"],"round_id":round_id}
                        db.execute("INSERT INTO proposals VALUES (?,?,?,?,?,?)",(uid("prop"),batch_id,"exploration",json.dumps(payload,ensure_ascii=False),"pending",now()))
                db.execute("INSERT INTO messages(id,exploration_id,card_id,role,body,created_at) VALUES (?,?,NULL,'assistant',?,?)",(uid("msg"),round_item["exploration_id"],result["reply"],now()))
                db.execute("UPDATE ai_runs SET status='completed',finished_at=? WHERE id=?",(now(),run_id))
            persistence_ms=round((time.perf_counter()-persistence_started)*1000)
            obs.measured_phase(run_id,"demiurgo.persistence",persistence_ms)
            with transaction() as db: db.execute("UPDATE ai_runs SET persistence_ms=? WHERE id=?",(persistence_ms,run_id))
            return
        raise RuntimeError("La ronda cambi\u00f3 varias veces durante el an\u00e1lisis; vuelve a revisarla cuando termine la actividad")
    except Exception as exc:
        with transaction() as db: db.execute("UPDATE ai_runs SET status='failed',error=?,finished_at=? WHERE id=? AND status='running'",(str(exc)[:1200],now(),run_id))
    finally:
        with LOCK: PROCESSES.pop(run_id,None)
