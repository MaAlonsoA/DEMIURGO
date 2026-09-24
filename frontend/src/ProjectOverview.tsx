import { useEffect, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'

type Item = Record<string, any>

export default function ProjectOverview({ projectId, onExplore, onRecord, onError, revision }: {
  projectId: string, revision: unknown, onExplore: (id: string, cardId?: string) => void,
  onRecord: (explorationId: string, kind: 'decision' | 'design', recordId: string) => void, onError: (message: string) => void
}) {
  const [data, setData] = useState<Item | null>(null)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [showVision, setShowVision] = useState(false)
  const autoRequested = useRef('')
  const load = async () => {
    const response = await fetch(`/api/projects/${projectId}/overview`)
    if (!response.ok) throw new Error('No se pudo cargar el proyecto')
    const next = await response.json()
    setData(next); setDraft(next.summary_pending?.body || '')
  }
  useEffect(() => { load().catch(error => onError(error.message)) }, [projectId, revision])
  const propose = async () => {
    setBusy(true)
    try {
      const response = await fetch(`/api/projects/${projectId}/summary/propose`, { method: 'POST' })
      if (!response.ok) throw new Error('No se pudo iniciar la síntesis')
      const { run_id } = await response.json()
      for (let i = 0; i < 90; i++) {
        await new Promise(resolve => window.setTimeout(resolve, 2000))
        const run = await (await fetch(`/api/runs/${run_id}`)).json()
        if (run.status === 'completed') { await load(); return }
        if (run.status !== 'running') throw new Error(run.error || 'La síntesis no se pudo generar')
      }
      throw new Error('La síntesis sigue en curso. Puedes volver a este proyecto más tarde.')
    } catch (error) { onError((error as Error).message) }
    finally { setBusy(false) }
  }
  useEffect(() => {
    if (!data?.original_vision || (data.summary_pending && data.summary_pending.facts_hash === data.facts_hash) || (!data.summary_outdated && data.summary && !data.summary_pending) || busy) return
    const key = projectId + ':' + data.facts_hash
    if (autoRequested.current === key) return
    autoRequested.current = key
    propose()
  }, [data?.facts_hash, data?.summary_pending?.id, data?.summary_outdated, projectId])
  const save = async (action: 'edit' | 'accept') => {
    if (!data?.summary_pending) return
    setBusy(true)
    try {
      const response = await fetch(`/api/projects/${projectId}/summary/${data.summary_pending.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ body: draft, action }) })
      if (!response.ok) throw new Error((await response.json()).detail || 'No se pudo guardar la síntesis')
      await load()
    } catch (error) { onError((error as Error).message) }
    finally { setBusy(false) }
  }
  if (!data) return <section className="overview"><p>Cargando proyecto…</p></section>
  const name = (id: string) => data.explorations.find((item: Item) => item.id === id)?.title || 'Exploración'
  const decisions = data.records.filter((item: Item) => item.kind === 'decision')
  const designs = data.records.filter((item: Item) => item.kind !== 'decision')
  const confirmed = data.cards.filter((item: Item) => item.status === 'confirmed')
  const open = data.cards.filter((item: Item) => item.status === 'pending' || item.status === 'inferred' || item.status === 'deferred')
  return <section className="overview">
    <div className="overview-hero"><p className="breadcrumb">Proyecto</p><h1>{data.project.name}</h1><p>Estado compartido del producto. Cada acuerdo, propuesta y borrador conserva su origen.</p></div>
    <div className="overview-layout"><div className="overview-primary">
      <article className="overview-panel"><h2>Visión original</h2>{data.original_vision ? <><div className="overview-markdown"><ReactMarkdown>{showVision ? data.original_vision.body : data.original_vision.body.slice(0, 600) + (data.original_vision.body.length > 600 ? '…' : '')}</ReactMarkdown></div><div className="item-actions">{data.original_vision.body.length > 600 && <button onClick={() => setShowVision(current => !current)}>{showVision ? 'Reducir visión' : 'Leer visión completa'}</button>}<button onClick={() => onExplore(data.original_vision.exploration_id)}>Ver conversación de origen</button></div></> : <p>Aún no se ha descrito la visión inicial.</p>}</article>
      <article className="overview-panel"><div className="overview-panel-head"><h2>Síntesis vigente</h2><button disabled={busy} onClick={propose}>{busy ? 'Generando…' : 'Proponer actualización'}</button></div>{data.summary ? <><div className="overview-markdown"><ReactMarkdown>{data.summary.body}</ReactMarkdown></div><small>Versión {data.summary.version}{data.summary_outdated ? ' · Hay cambios posteriores pendientes de revisión' : ''}</small></> : <p>Aún no hay una síntesis aceptada. Los registros de abajo muestran el estado actual.</p>}{data.summary_pending && <div className="overview-summary-draft"><span className="badge pending">Propuesta de síntesis · v{data.summary_pending.version}</span><textarea aria-label="Corregir síntesis propuesta" value={draft} onChange={event => setDraft(event.target.value)} rows={9}/><div className="item-actions"><button disabled={busy || !draft.trim()} onClick={() => save('edit')}>Guardar corrección</button><button disabled={busy || !draft.trim() || data.summary_pending.facts_hash !== data.facts_hash} onClick={() => save('accept')}>Aceptar síntesis</button></div>{data.summary_pending.facts_hash !== data.facts_hash && <p>Los hechos cambiaron. Genera una propuesta nueva para poder aceptarla.</p>}</div>}</article>
      <article className="overview-panel"><h2>Acuerdos confirmados</h2>{confirmed.length ? confirmed.map((item: Item) => <div className="overview-entry" key={item.id}><span className="badge">Confirmado por la persona</span><strong>{item.question}</strong><p>{item.conclusion}</p><button onClick={() => onExplore(item.exploration_id,item.id)}>Ver pregunta · {name(item.exploration_id)}</button></div>) : <p>Aún no hay respuestas confirmadas.</p>}</article>
      <article className="overview-panel"><h2>Preguntas abiertas</h2>{open.length ? open.map((item: Item) => <div className="overview-entry" key={item.id}><span className="badge pending">{item.status === 'inferred' ? 'Inferida · pendiente de confirmar' : item.status === 'deferred' ? 'Pospuesta' : 'Abierta'}</span><strong>{item.question}</strong><button onClick={() => onExplore(item.exploration_id,item.id)}>Abrir · {name(item.exploration_id)}</button></div>) : <p>No hay preguntas abiertas.</p>}</article>
    </div><div className="overview-secondary">
      <article className="overview-panel"><h2>Exploraciones</h2>{data.explorations.map((item: Item) => <div className="overview-entry" key={item.id}><span className="badge">{item.parent_id ? 'Línea aceptada' : 'Inicial'}</span><button onClick={() => onExplore(item.id)}>{item.title}</button>{item.parent_id && <small>Origen: {name(item.parent_id)}</small>}</div>)}{data.proposals.filter((p: Item) => p.kind === 'exploration').map((p: Item) => <div className="overview-entry" key={p.id}><span className="badge pending">Propuesta · sin aceptar</span><strong>{p.payload.title}</strong><small>Origen: {name(p.payload.parent_id)}</small></div>)}</article>
      <article className="overview-panel"><h2>Decisiones</h2>{decisions.map((item: Item) => <div className="overview-entry" key={item.id}><span className={'badge ' + (item.status === 'draft' ? 'pending' : '')}>{item.status === 'approved' ? 'Aprobada' : item.status === 'draft' ? 'Borrador · requiere aprobación' : 'Sustituida'}</span><button onClick={() => onRecord(item.exploration_id,'decision',item.id)}>{item.title}</button><small>{name(item.exploration_id)} · revisión {item.current_revision}</small>{item.origin_needs_review && <small>La conclusión de origen cambió · revisar esta decisión</small>}</div>)}{data.proposals.filter((p: Item) => p.kind === 'decision').map((p: Item) => <div className="overview-entry" key={p.id}><span className="badge pending">Propuesta · sin artefacto</span><strong>{p.payload.title}</strong></div>)}{!decisions.length && !data.proposals.some((p: Item) => p.kind === 'decision') && <p>Aún no hay decisiones.</p>}</article>
      <article className="overview-panel"><h2>Diseños</h2>{designs.length ? designs.map((item: Item) => <div className="overview-entry" key={item.id}><span className="badge">{item.kind.toUpperCase()} · {item.status === 'approved' ? 'Aprobado' : 'Borrador'}</span><button onClick={() => onRecord(item.exploration_id,'design',item.id)}>{item.title}</button></div>) : <p>Aún no hay diseños.</p>}</article>
    </div></div>
  </section>
}
