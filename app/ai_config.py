"""Provider profiles and per-task AI overrides."""
import json
import os
import re
import shutil
import urllib.error
import urllib.request
from urllib.parse import urlparse

from .db import connect, transaction, rows
from .domain import now, one

DEFAULT_QWEN_BASE_URL = os.environ.get("DEMIURGO_QWEN_BASE_URL", "http://host.docker.internal:8080/v1").rstrip("/")

ACTION_DEFINITIONS = [
    {"key": "exploration_initial", "label": "Primera exploración", "description": "Analiza la visión inicial y plantea el primer paso.", "active": True},
    {"key": "exploration_chat", "label": "Conversación de exploración", "description": "Responde en el chat principal después del primer mensaje.", "active": True},
    {"key": "question_response", "label": "Respuestas a preguntas", "description": "Analiza cada respuesta dentro de su propia pregunta.", "active": True},
    {"key": "round_review", "label": "Revisión de ronda", "description": "Sintetiza las respuestas y propone nuevas líneas de exploración.", "active": True},
    {"key": "source_analysis", "label": "Análisis de documentos", "description": "Clasifica y extrae propuestas al importar una visión o documento.", "active": True},
    {"key": "categorization", "label": "Categorización", "description": "Perfil preparado para una acción de categorización independiente.", "active": False},
]
ACTION_KEYS = {item["key"] for item in ACTION_DEFINITIONS}
EFFORTS = {
    "codex": ["low", "medium", "high", "xhigh"],
    "qwen": ["low", "medium", "xhigh"],
}
PROVIDER_DEFINITIONS = [
    {"key": "codex", "label": "Codex", "default_base_url": "", "efforts": EFFORTS["codex"]},
    {"key": "qwen", "label": "Qwen local", "default_base_url": DEFAULT_QWEN_BASE_URL, "efforts": EFFORTS["qwen"]},
]


def normalize_base_url(value):
    value = str(value or DEFAULT_QWEN_BASE_URL).strip().rstrip("/")
    parsed = urlparse(value)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc or parsed.username or parsed.password:
        raise ValueError("La URL de Qwen debe ser HTTP o HTTPS y no incluir credenciales.")
    return value


def normalize_profile(value):
    provider = str(value.get("provider") or "").strip().lower()
    if provider not in EFFORTS:
        raise ValueError("Proveedor no válido. Elige Codex o Qwen local.")
    model = str(value.get("model") or "").strip()
    if not model or len(model) > 160:
        raise ValueError("Indica un identificador de modelo (máximo 160 caracteres).")
    effort = str(value.get("reasoning_effort") or value.get("effort") or "").strip().lower()
    if effort not in EFFORTS[provider]:
        options = ", ".join(EFFORTS[provider])
        raise ValueError(f"Esfuerzo no compatible con {provider}: {options}.")
    base_url = normalize_base_url(value.get("base_url")) if provider == "qwen" else ""
    return {"provider": provider, "model": model, "reasoning_effort": effort, "base_url": base_url}


def _action_profile(db, action_key):
    if action_key not in ACTION_KEYS:
        raise ValueError("Acción de modelo no reconocida.")
    row = one(db, "SELECT * FROM ai_action_profiles WHERE action_key=?", (action_key,))
    if not row:
        raise ValueError("Falta la configuración para esta acción. Comprueba las migraciones de la aplicación.")
    definition = next(item for item in ACTION_DEFINITIONS if item["key"] == action_key)
    return {**definition, **normalize_profile(row)}


def _task_override(db, scope_type, scope_id):
    if not scope_type or not scope_id:
        return None
    row = one(db, "SELECT * FROM ai_task_overrides WHERE scope_type=? AND scope_id=?", (scope_type, scope_id))
    return normalize_profile(row) if row else None


def resolve_profile(db, action_key, scope_type=None, scope_id=None):
    action_profile = _action_profile(db, action_key)
    override = _task_override(db, scope_type, scope_id)
    inherited = False
    if override is None and scope_type == "card" and scope_id:
        card = one(db, "SELECT exploration_id FROM cards WHERE id=?", (scope_id,))
        if card:
            override = _task_override(db, "exploration", card["exploration_id"])
            inherited = bool(override)
    effective = {**action_profile, **override} if override else action_profile.copy()
    effective["task_override"] = bool(override)
    effective["inherited_override"] = inherited
    effective["default"] = {key: action_profile[key] for key in ("provider", "model", "reasoning_effort", "base_url")}
    return effective


def get_settings():
    import os
    with connect() as db:
        configured = []
        for action in ACTION_DEFINITIONS:
            configured.append(_action_profile(db, action["key"]))
    codex_available = os.environ.get("DEMIURGO_DISABLE_CODEX") != "1" and shutil.which("codex") is not None
    return {
        "actions": configured,
        "providers": [
            {**PROVIDER_DEFINITIONS[0], "available": codex_available, "status": "Disponible" if codex_available else "Codex CLI no está disponible"},
            {**PROVIDER_DEFINITIONS[1], "available": None, "status": "Se comprueba al conectar"},
        ],
    }


def save_action_profile(action_key, value):
    if action_key not in ACTION_KEYS:
        raise ValueError("Acción de modelo no reconocida.")
    profile = normalize_profile(value)
    with transaction() as db:
        db.execute("""INSERT INTO ai_action_profiles(action_key,provider,model,reasoning_effort,base_url,updated_at)
            VALUES (?,?,?,?,?,?) ON CONFLICT(action_key) DO UPDATE SET provider=excluded.provider,model=excluded.model,
            reasoning_effort=excluded.reasoning_effort,base_url=excluded.base_url,updated_at=excluded.updated_at""",
            (action_key, profile["provider"], profile["model"], profile["reasoning_effort"], profile["base_url"], now()))
        return _action_profile(db, action_key)


def get_selection(scope_type, scope_id, action_key):
    if scope_type not in {"exploration", "card", "source"}:
        raise ValueError("Tipo de tarea no válido.")
    with connect() as db:
        if not one(db, {"exploration": "SELECT id FROM explorations WHERE id=?", "card": "SELECT id FROM cards WHERE id=?", "source": "SELECT id FROM sources WHERE id=?"}[scope_type], (scope_id,)):
            raise ValueError("No se encontró la conversación o tarea.")
        return resolve_profile(db, action_key, scope_type, scope_id)


def save_task_selection(scope_type, scope_id, value, reset=False):
    if scope_type not in {"exploration", "card", "source"}:
        raise ValueError("Tipo de tarea no válido.")
    with transaction() as db:
        query = {"exploration": "SELECT id FROM explorations WHERE id=?", "card": "SELECT id FROM cards WHERE id=?", "source": "SELECT id FROM sources WHERE id=?"}[scope_type]
        if not one(db, query, (scope_id,)):
            raise ValueError("No se encontró la conversación o tarea.")
        if reset:
            db.execute("DELETE FROM ai_task_overrides WHERE scope_type=? AND scope_id=?", (scope_type, scope_id))
            return {"ok": True, "reset": True}
        profile = normalize_profile(value)
        db.execute("""INSERT INTO ai_task_overrides(scope_type,scope_id,provider,model,reasoning_effort,base_url,updated_at)
            VALUES (?,?,?,?,?,?,?) ON CONFLICT(scope_type,scope_id) DO UPDATE SET provider=excluded.provider,model=excluded.model,
            reasoning_effort=excluded.reasoning_effort,base_url=excluded.base_url,updated_at=excluded.updated_at""",
            (scope_type, scope_id, profile["provider"], profile["model"], profile["reasoning_effort"], profile["base_url"], now()))
        return {"ok": True, "selection": profile}


def get_models(provider, base_url=""):
    if provider == "codex":
        return {"models": [], "note": "Escribe el nombre del modelo de Codex que quieras usar."}
    if provider != "qwen":
        raise ValueError("Proveedor no reconocido.")
    base_url = normalize_base_url(base_url)
    request = urllib.request.Request(base_url + "/models", headers={"Accept": "application/json"})
    try:
        with urllib.request.urlopen(request, timeout=6) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", "replace")[:500]
        raise RuntimeError(f"Qwen respondió HTTP {exc.code}: {detail}") from exc
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as exc:
        raise RuntimeError(f"No se pudo conectar con Qwen en {base_url}: {exc}") from exc
    models = [str(item.get("id")) for item in payload.get("data", []) if isinstance(item, dict) and item.get("id")]
    return {"models": models, "base_url": base_url}


def _extract_json_object(text):
    text=re.sub(r"```(?:json)?\s*|\s*```","",str(text or ""),flags=re.IGNORECASE).strip()
    decoder=json.JSONDecoder()
    for match in re.finditer(r"\{",text):
        try:
            value,_=decoder.raw_decode(text,match.start())
            if isinstance(value,dict): return value
        except json.JSONDecodeError:
            continue
    return None


def test_provider(provider, base_url="", model="", reasoning_effort="low"):
    if provider == "codex":
        ok = os.environ.get("DEMIURGO_DISABLE_CODEX") != "1" and shutil.which("codex") is not None
        return {"ok": ok, "provider": provider, "message": "Codex CLI disponible." if ok else "Codex CLI no está disponible."}
    result = get_models(provider, base_url)
    profile = normalize_profile({"provider": provider, "model": model or (result["models"] or [""])[0], "reasoning_effort": reasoning_effort, "base_url": result["base_url"]})
    payload={"model":profile["model"],"messages":[{"role":"system","content":"Devuelve solo un objeto JSON válido."},{"role":"user","content":"Devuelve exactamente este objeto JSON: {\"ok\":true}"}],"reasoning_effort":profile["reasoning_effort"],"temperature":0,"max_tokens":256}
    request=urllib.request.Request(profile["base_url"]+"/chat/completions",data=json.dumps(payload).encode("utf-8"),headers={"Content-Type":"application/json","Accept":"application/json"},method="POST")
    try:
        with urllib.request.urlopen(request,timeout=180) as response:
            completion=json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        detail=exc.read().decode("utf-8","replace")[:500]
        raise RuntimeError(f"Qwen respondió HTTP {exc.code}: {detail}") from exc
    except (urllib.error.URLError,TimeoutError,json.JSONDecodeError) as exc:
        raise RuntimeError(f"No se pudo completar una respuesta de prueba con Qwen: {exc}") from exc
    choices=completion.get("choices") or []
    message=(choices[0].get("message") or {}) if choices else {}
    content=message.get("content")
    if isinstance(content,list): content="".join(str(part.get("text") or "") for part in content if isinstance(part,dict))
    parsed=_extract_json_object(content)
    if not parsed or parsed.get("ok") is not True:
        raise RuntimeError("Qwen respondió, pero no produjo el JSON de prueba esperado.")
    return {"ok":True,"provider":provider,"models":result["models"],"model":completion.get("model") or profile["model"],"reasoning_effort":profile["reasoning_effort"],"message":"Conexión y generación JSON verificadas."}
