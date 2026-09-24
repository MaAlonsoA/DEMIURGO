"""Local OpenTelemetry trace adapter; GenAI attribute names are isolated here."""
import json
import time
from datetime import datetime, timezone
from opentelemetry import trace
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import SimpleSpanProcessor, SpanExporter, SpanExportResult
from opentelemetry.trace.propagation.tracecontext import TraceContextTextMapPropagator
from .db import transaction

SEMCONV_VERSION = "genai-2026-09"
GENAI = {
    "requested_model": "gen_ai.request.model",
    "observed_model": "gen_ai.response.model",
    "input_tokens": "gen_ai.usage.input_tokens",
    "cached_input_tokens": "gen_ai.usage.text.cache_read.input_tokens",
    "output_tokens": "gen_ai.usage.output_tokens",
    "reasoning_output_tokens": "gen_ai.usage.reasoning.output_tokens",
}


class LocalExporter(SpanExporter):
    def export(self, spans):
        with transaction() as db:
            for span in spans:
                attrs = dict(span.attributes or {})
                run_id = attrs.get("demiurgo.run_id")
                if not run_id:
                    continue
                if not db.execute("SELECT 1 FROM ai_runs WHERE id=?", (run_id,)).fetchone():
                    continue
                db.execute("""INSERT OR IGNORE INTO ai_spans
                    (span_id,run_id,trace_id,parent_span_id,name,started_at,finished_at,attributes_json)
                    VALUES (?,?,?,?,?,?,?,?)""", (
                    f"{span.context.span_id:016x}", run_id,
                    f"{span.context.trace_id:032x}",
                    f"{span.parent.span_id:016x}" if span.parent else None,
                    span.name,
                    datetime.fromtimestamp(span.start_time / 1e9, timezone.utc).isoformat(),
                    datetime.fromtimestamp(span.end_time / 1e9, timezone.utc).isoformat(),
                    json.dumps(attrs, ensure_ascii=False),
                ))
        return SpanExportResult.SUCCESS


provider = TracerProvider()
provider.add_span_processor(SimpleSpanProcessor(LocalExporter()))
tracer = provider.get_tracer("demiurgo.codex", "1")


def traceparent():
    carrier = {}
    TraceContextTextMapPropagator().inject(carrier)
    return carrier.get("traceparent")


def usage_attributes(usage):
    return {GENAI[key]: value for key, value in usage.items() if key in GENAI and value is not None}


def measured_phase(run_id, name, duration_ms):
    finished = time.time_ns()
    span = tracer.start_span(name, start_time=finished - duration_ms * 1_000_000,
                             attributes={"demiurgo.run_id": run_id, "demiurgo.duration_ms": duration_ms})
    span.end(end_time=finished)


def summarize_events(events):
    """Sum completed distinct turns; subsets remain subsets, never added twice."""
    turns = set()
    tools = set()
    usages = {}
    model = None
    current_turn = None
    turn_number = 0
    for seq, event in enumerate(events):
        kind = event.get("type")
        if kind == "turn.started":
            turn_number += 1
            current_turn = event.get("turn_id") or event.get("id") or f"turn-{turn_number}"
        turn_id = event.get("turn_id") or event.get("id") or current_turn or f"turn-{turn_number or 1}"
        if kind in {"turn.started", "turn.completed", "turn.failed"}:
            turns.add(turn_id)
        if kind == "turn.completed" and isinstance(event.get("usage"), dict):
            usages[turn_id] = event["usage"]
        if kind in {"turn.completed", "turn.failed"}:
            current_turn = None
        item = event.get("item") or {}
        if kind in {"item.started", "item.completed"} and isinstance(item, dict) and item.get("type") in {
            "command_execution", "mcp_tool_call", "web_search", "file_change", "tool_call"
        }:
            tools.add(item.get("id") or f"{turn_id}:{item.get('type')}:{seq}")
        model = event.get("model") or (event.get("response") or {}).get("model") or model
    names = {
        "input_tokens": "input_tokens",
        "cached_input_tokens": "cached_input_tokens",
        "output_tokens": "output_tokens",
        "reasoning_output_tokens": "reasoning_output_tokens",
    }
    result = {}
    provenance = {}
    for target, source in names.items():
        values = [u[source] for u in usages.values() if isinstance(u.get(source), int)]
        result[target] = sum(values) if values else None
        provenance[target] = "codex.turn.completed.usage" if values else "not_reported"
    result.update(turns=len(turns), tool_calls=len(tools), model_calls=None, observed_model=model)
    provenance.update(turns="codex.events", tool_calls="codex.events", model_calls="not_reported", cli_invocations="demiurgo.process")
    return result, provenance
