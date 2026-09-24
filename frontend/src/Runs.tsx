import { useEffect, useState } from 'react'

type Item = Record<string, any>
const value = (x: unknown) => x == null ? 'No reportado' : String(x)
const kind = (run: Item) => run.round_id ? 'Revisión de ronda' : run.card_id ? 'Tarjeta' : run.source_id ? 'Fuente' : 'Chat principal'
const labels: Record<string, string> = { input_tokens: 'Tokens de entrada', cached_input_tokens: 'Entrada en caché', output_tokens: 'Tokens de salida', reasoning_output_tokens: 'Razonamiento', cli_invocations: 'Invocaciones CLI', turns: 'Turnos', tool_calls: 'Herramientas', model_calls: 'Llamadas al modelo' }

export default function Runs({ projectId, initialRunId, onClose }: { projectId: string, initialRunId?: string, onClose: () => void }) {
  const [list, setList] = useState<Item[]>([])
  const [total, setTotal] = useState(0)
  const [offset, setOffset] = useState(0)
  const [detail, setDetail] = useState<Item | null>(null)
  const [events, setEvents] = useState<Item[]>([])
  const [eventTotal, setEventTotal] = useState(0)
  const [eventOffset, setEventOffset] = useState(0)
  const [error, setError] = useState('')
  const get = async (path: string) => {
    const response = await fetch('/api' + path)
    if (!response.ok) throw new Error((await response.json()).detail || 'Error al consultar la traza')
    return response.json()
  }
  const loadList = async (page = 0) => {
    try {
      const result = await get(`/projects/${encodeURIComponent(projectId)}/runs?limit=20&offset=${page}`)
      setList(result.items); setTotal(result.total); setOffset(page); setDetail(null)
    } catch (e) { setError((e as Error).message) }
  }
  const loadRun = async (id: string, page = 0) => {
    try {
      const [run, chronology] = await Promise.all([get(`/runs/${encodeURIComponent(id)}`), get(`/runs/${encodeURIComponent(id)}/events?limit=100&offset=${page}`)])
      setDetail(run); setEvents(chronology.items); setEventTotal(chronology.total); setEventOffset(page)
    } catch (e) { setError((e as Error).message) }
  }
  useEffect(() => { if (initialRunId) loadRun(initialRunId); else loadList() }, [projectId, initialRunId])
  useEffect(() => {
    if (detail?.status !== 'running') return
    const timer = window.setInterval(() => loadRun(detail.id, eventOffset), 2000)
    return () => window.clearInterval(timer)
  }, [detail?.id, detail?.status, eventOffset])
  const fields = ['input_tokens', 'cached_input_tokens', 'output_tokens', 'reasoning_output_tokens', 'cli_invocations', 'turns', 'tool_calls', 'model_calls']
  return <div className="drawer-wrap" onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}><div className="drawer run-drawer" role="dialog" aria-modal="true" aria-label="Ejecuciones"><button className="drawer-close" onClick={onClose}>Cerrar</button>
    {error && <p role="alert">{error}</p>}
    {detail ? <><button className="detail-link" onClick={() => loadList()}>← Ejecuciones del proyecto</button><p className="drawer-kicker">Traza {detail.trace_id}</p><h2>{kind(detail)} · análisis #{detail.attempt}</h2><p><strong>{detail.status}</strong> · {new Date(detail.started_at).toLocaleString('es-ES')} · {detail.round_id || detail.message_id || detail.source_id}</p><button className="detail-link" onClick={() => loadRun(detail.id, eventOffset)}>Actualizar traza</button>
      <section className="detail-section"><h3>Modelo y método</h3><p>Solicitado: {value(detail.requested_model)} · Observado: {value(detail.observed_model)}</p><p>Esfuerzo: {value(detail.reasoning_effort)} · Agente: {value(detail.agent)} {value(detail.agent_version)} · Método: {value(detail.method_version)}</p><p>Traceparent: {value(detail.traceparent)}</p></section>
      <section className="detail-section"><h3>Proveedor seleccionado</h3><p>{detail.provider === 'qwen' ? 'Qwen local' : 'Codex'} · {value(detail.requested_model)} · esfuerzo {value(detail.reasoning_effort)}</p>{detail.requested_base_url && <p>Dirección: {value(detail.requested_base_url)}</p>}</section>
      <section className="detail-section"><h3>Uso</h3><div className="run-metrics">{fields.map(key => <div key={key}><strong>{labels[key]}</strong><span>{value(detail[key])}</span><small>{detail.usage_provenance?.[key] || 'No disponible'}</small></div>)}</div><p className="detail-note">Los tokens en caché están incluidos en los de entrada; los de razonamiento, en los de salida. «No reportado» no equivale a cero.</p></section>
      <section className="detail-section"><h3>Tiempos medidos por DEMIURGO</h3><div className="run-metrics">{['context_ms', 'invocation_ms', 'validation_ms', 'persistence_ms'].map(key => <div key={key}><strong>{key.replace('_ms', '')}</strong><span>{detail[key] == null ? 'No disponible' : `${detail[key]} ms`}</span></div>)}</div></section>
      {detail.error && <section className="detail-section"><h3>Error</h3><pre className="source-text">{detail.error}</pre></section>}
      <section className="detail-section"><h3>Prompt enviado</h3><pre className="source-text">{detail.prompt ?? 'No disponible (registro histórico)'}</pre></section>
      <section className="detail-section"><h3>Resultado final</h3><pre className="source-text">{detail.result_json ?? 'No disponible'}</pre></section>
      <section className="detail-section"><h3>Fases de la traza</h3>{detail.spans?.map((span: Item) => <p key={span.span_id}>{span.name} · {span.started_at} → {span.finished_at}</p>)}</section>
      <section className="detail-section"><h3>Eventos del proveedor ({eventTotal})</h3>{events.map(event => <details key={event.seq}><summary>#{event.seq} · {event.received_at}</summary><pre className="source-text">{event.raw_json}</pre></details>)}<div className="run-pages"><button disabled={eventOffset === 0} onClick={() => loadRun(detail.id, Math.max(0, eventOffset - 100))}>Anterior</button><button disabled={eventOffset + 100 >= eventTotal} onClick={() => loadRun(detail.id, eventOffset + 100)}>Siguiente</button></div></section>
    </> : <><h2>Ejecuciones</h2><button className="detail-link" onClick={() => loadList(offset)}>Actualizar lista</button>{list.map(run => <button className="detail-link" key={run.id} onClick={() => loadRun(run.id)}><strong>{kind(run)} · #{run.attempt} · {run.status}</strong> · {new Date(run.started_at).toLocaleString('es-ES')}<br/><small>{run.trace_id} · entrada {value(run.input_tokens)} · salida {value(run.output_tokens)}</small></button>)}<div className="run-pages"><button disabled={offset === 0} onClick={() => loadList(Math.max(0, offset - 20))}>Anterior</button><span>{total ? offset + 1 : 0}–{Math.min(offset + 20, total)} de {total}</span><button disabled={offset + 20 >= total} onClick={() => loadList(offset + 20)}>Siguiente</button></div></>}
  </div></div>
}
