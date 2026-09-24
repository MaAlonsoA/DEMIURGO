import { useEffect, useState } from 'react'
import ReactMarkdown from 'react-markdown'

type Item = Record<string, any>
type Phase = 'decision' | 'design'

async function api(path: string, method = 'GET', body?: unknown): Promise<any> {
  const response = await fetch('/api' + path, { method, headers: body === undefined ? undefined : { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
  const json = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(json.detail || 'No se pudo guardar el artefacto')
  return json
}

export default function Artifacts({ exploration, records, proposals, phase, onChanged, onError, onExplore, initialRecordId }: {
  exploration: Item, records: Item[], proposals: Item[], phase: Phase, onChanged: () => Promise<unknown>, onError: (message: string) => void,
  onExplore: (record: Item) => void, initialRecordId?: string
}) {
  const decisions = records.filter(record => record.kind === 'decision')
  const visible = records.filter(record => phase === 'decision' ? record.kind === 'decision' : record.kind === 'adr' || record.kind === 'fdr')
  const [selectedId, setSelectedId] = useState('')
  const [detail, setDetail] = useState<any>(null)
  const [editing, setEditing] = useState(false)
  const [kind, setKind] = useState<'decision' | 'adr' | 'fdr'>('decision')
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [reason, setReason] = useState('')
  const [status, setStatus] = useState('draft')
  const [decisionId, setDecisionId] = useState('')
  const [busy, setBusy] = useState(false)
  const [proposalDecisions, setProposalDecisions] = useState<Record<string, string>>({})
  const pending = proposals.filter(proposal => proposal.status === 'pending' && (phase === 'decision' ? proposal.kind === 'decision' : proposal.kind === 'adr' || proposal.kind === 'fdr'))

  useEffect(() => { setSelectedId(initialRecordId || ''); setDetail(null); setEditing(false); setKind(phase === 'decision' ? 'decision' : 'fdr') }, [exploration.id, phase, initialRecordId])
  useEffect(() => {
    if (!selectedId) { setDetail(null); return }
    api('/records/' + selectedId).then(setDetail).catch(error => onError(error.message))
  }, [selectedId, records, onError])

  const startNew = () => {
    setSelectedId(''); setDetail(null); setEditing(true)
    setKind(phase === 'decision' ? 'decision' : 'fdr')
    setTitle(''); setBody(''); setReason(''); setStatus('draft'); setDecisionId(decisions[0]?.id || '')
  }
  const edit = (record: Item) => {
    setSelectedId(record.id); setEditing(true); setKind(record.kind)
    setTitle(record.title); setBody(record.body); setReason(''); setStatus(record.status)
  }
  const save = async (event: React.FormEvent) => {
    event.preventDefault()
    setBusy(true)
    try {
      if (selectedId) {
        await api('/records/' + selectedId + '/revisions', 'POST', { title: title.trim(), body: body.trim(), reason: reason.trim(), status })
        setDetail(await api('/records/' + selectedId))
      } else {
        const created = await api('/records', 'POST', { exploration_id: exploration.id, kind, title: title.trim(), body: body.trim(), reason: reason.trim() || 'Creación', status, decision_id: phase === 'design' ? decisionId : undefined })
        setSelectedId(created.id)
      }
      setEditing(false)
      await onChanged()
    } catch (error) { onError((error as Error).message) }
    finally { setBusy(false) }
  }
  const selected = visible.find(record => record.id === selectedId)
  const originCard = detail?.origins?.['1']?.card
  const sourceDecision = detail?.links?.find((link: Item) => link.relation === 'design_of' && link.target_id === selectedId)
  const resolve = async (proposal: Item, choice: 'accepted' | 'discarded') => {
    setBusy(true)
    try {
      if (choice === 'accepted' && phase === 'design') await api('/proposals/' + proposal.id, 'PATCH', { decision_id: proposalDecisions[proposal.id] || decisions[0]?.id })
      await api('/batches/' + proposal.batch_id + '/resolve', 'POST', { choices: { [proposal.id]: choice } })
      await onChanged()
    } catch (error) { onError((error as Error).message) }
    finally { setBusy(false) }
  }
  return <section className="artifact-workspace">
    <div className="artifact-heading"><div><p className="breadcrumb">{exploration.title} / {phase === 'decision' ? 'Decisiones' : 'Diseños'}</p><h1>{phase === 'decision' ? 'Decisiones' : 'Diseños ADR y FDR'}</h1><p>{phase === 'decision' ? 'Acuerdos explícitos que cierran incertidumbres de esta exploración.' : 'Diseños funcionales y arquitectónicos justificados en una decisión.'}</p></div><button className="primary" onClick={startNew}>{phase === 'decision' ? '+ Nueva decisión' : '+ Nuevo diseño'}</button></div>
    {pending.length > 0 && <div className="artifact-proposals"><h2>Propuestas pendientes</h2>{pending.map(proposal => { const payload = JSON.parse(proposal.payload); return <article key={proposal.id}><strong>{payload.title}</strong><p>{payload.body}</p>{phase === 'design' && <label>Decisión de origen<select value={proposalDecisions[proposal.id] || decisions[0]?.id || ''} onChange={event => setProposalDecisions(current => ({ ...current, [proposal.id]: event.target.value }))}><option value="">Selecciona una decisión</option>{decisions.map(decision => <option key={decision.id} value={decision.id}>{decision.title}</option>)}</select></label>}<div className="artifact-actions"><button disabled={busy || (phase === 'design' && !decisions.length)} onClick={() => resolve(proposal, 'accepted')}>Aceptar</button><button disabled={busy} onClick={() => resolve(proposal, 'discarded')}>Descartar</button></div></article> })}</div>}
    <div className="artifact-columns"><div className="artifact-list"><h2>{phase === 'decision' ? 'Decisiones de la exploración' : 'Diseños de la exploración'}</h2>{visible.length ? visible.map(record => <button key={record.id} className={'artifact-row ' + (selectedId === record.id ? 'selected' : '')} onClick={() => { setEditing(false); setSelectedId(record.id) }}><span>{record.kind.toUpperCase()} · {record.status === 'approved' ? 'Aprobado' : record.status === 'superseded' ? 'Sustituido' : 'Borrador'}</span><strong>{record.title}</strong><small>Revisión {record.current_revision}</small></button>) : <p className="artifact-empty">Aún no hay artefactos en esta fase.</p>}</div>
      <div className="artifact-detail">{editing ? <form onSubmit={save}><h2>{selectedId ? 'Nueva revisión' : phase === 'decision' ? 'Nueva decisión' : 'Nuevo diseño'}</h2>{!selectedId && <><label>Tipo<select value={kind} onChange={event => setKind(event.target.value as typeof kind)}>{phase === 'decision' ? <option value="decision">Decisión</option> : <><option value="fdr">FDR · diseño funcional</option><option value="adr">ADR · decisión de arquitectura</option></>}</select></label>{phase === 'design' && <label>Decisión que justifica este diseño<select value={decisionId} onChange={event => setDecisionId(event.target.value)} required><option value="">Selecciona una decisión</option>{decisions.map(decision => <option key={decision.id} value={decision.id}>{decision.title}</option>)}</select></label>}</>}
        <label>Título<input value={title} onChange={event => setTitle(event.target.value)} required/></label><label>Contenido<textarea value={body} onChange={event => setBody(event.target.value)} required rows={12} placeholder={phase === 'decision' ? 'Qué se decide, por qué y qué queda fuera' : 'Comportamiento, límites, alternativas y criterios de aceptación'}/></label><label>Estado<select value={status} onChange={event => setStatus(event.target.value)}><option value="draft">Borrador</option><option value="approved">Aprobado</option><option value="superseded">Sustituido</option></select></label><label>Motivo{selectedId ? ' de la revisión' : ''}<input value={reason} onChange={event => setReason(event.target.value)} required={!!selectedId}/></label><div className="artifact-actions"><button type="button" onClick={() => setEditing(false)}>Cancelar</button><button className="primary" disabled={busy || !title.trim() || !body.trim() || (phase === 'design' && !selectedId && !decisionId)}>{busy ? 'Guardando…' : 'Guardar'}</button></div></form> : selected ? <><div className="artifact-meta"><span>{selected.kind.toUpperCase()}</span><span>{selected.status === 'approved' ? 'Aprobado' : selected.status === 'superseded' ? 'Sustituido' : 'Borrador'}</span><span>Revisión {selected.current_revision}</span></div><h2>{selected.title}</h2>{originCard && <p className="artifact-source">Origen: pregunta confirmada: {originCard.question}</p>}{sourceDecision && <p className="artifact-source">Basado en: {decisions.find(record => record.id === sourceDecision.source_id)?.title || sourceDecision.source_id}</p>}<div className="artifact-body"><ReactMarkdown>{selected.body}</ReactMarkdown></div><div className="artifact-actions"><button onClick={() => edit(selected)}>Revisar artefacto</button><button onClick={() => onExplore(selected)}>Abrir nueva exploración desde aquí</button></div>{detail && <details className="artifact-history"><summary>Historial de revisiones ({detail.revisions.length})</summary>{detail.revisions.map((revision: Item) => <div key={revision.version}><strong>v{revision.version} · {revision.status}</strong><p>{revision.reason}</p></div>)}</details>}</> : <div className="artifact-placeholder">Selecciona un artefacto o crea uno nuevo para continuar el diseño del MVP.</div>}</div>
    </div>
  </section>
}
