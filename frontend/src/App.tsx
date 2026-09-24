import { useCallback, useEffect, useState } from 'react'
import Runs from './Runs'
import Artifacts from './Artifacts'
import ExplorationContext from './ExplorationContext'
import AISettings from './AISettings'
import ConversationPane from './ConversationPane'
import ProjectOverview from './ProjectOverview'

type Item = Record<string, any>
type State = {
  projects: Item[]
  explorations: Item[]
  cards: Item[]
  rounds: Item[]
  runs: Item[]
  batches: Item[]
  proposals: Item[]
  records: Item[]
  codex_available: boolean
  codex_model: string
  codex_reasoning_effort: string
  codex_strategic_model: string
  codex_strategic_reasoning_effort: string
  codex_method_version: string
}
type Dialog = 'project' | 'question' | 'exploration' | null
type Phase = 'exploration' | 'decision' | 'design' | 'implementation' | 'review'
const empty: State = { projects: [], explorations: [], cards: [], rounds: [], runs: [], batches: [], proposals: [], records: [], codex_available: false, codex_model: 'gpt-6-luna', codex_reasoning_effort: 'medium', codex_strategic_model: 'gpt-6-sol', codex_strategic_reasoning_effort: 'high', codex_method_version: 'v6' }

async function api(path: string, method = 'GET', body?: unknown): Promise<any> {
  const response = await fetch('/api' + path, { method, headers: body === undefined ? undefined : { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
  const json = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(typeof json.detail === 'string' ? json.detail : 'No se pudo completar la operación')
  return json
}

export default function App() {
  const [state, setState] = useState<State>(empty)
  const [projectId, setProjectId] = useState('')
  const [explorationId, setExplorationId] = useState('')
  const [messages, setMessages] = useState<Item[]>([])
  const [mainMessages, setMainMessages] = useState<Item[]>([])
  const [context, setContext] = useState<Item | null>(null)
  const [mainContext, setMainContext] = useState<Item | null>(null)
  const [selectedCardId, setSelectedCardId] = useState('')
  const [draft, setDraft] = useState('')
  const [questionDraft, setQuestionDraft] = useState('')
  const [projectName, setProjectName] = useState('')
  const [question, setQuestion] = useState('')
  const [reason, setReason] = useState('')
  const [dialog, setDialog] = useState<Dialog>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [openRuns, setOpenRuns] = useState<string | null>(null)
  const [aiSettingsOpen, setAISettingsOpen] = useState(false)
  const [phase, setPhase] = useState<Phase>('exploration')
  const [overviewOpen, setOverviewOpen] = useState(true)
  const [focusRecordId, setFocusRecordId] = useState('')
  const [explorationTitle, setExplorationTitle] = useState('')
  const [explorationPurpose, setExplorationPurpose] = useState('')
  const [originRecordId, setOriginRecordId] = useState('')

  const load = useCallback(async () => {
    const next: State = await api('/state')
    setState(next)
    setProjectId(current => next.projects.some(p => p.id === current) ? current : next.projects[0]?.id || '')
    return next
  }, [])
  const project = state.projects.find(p => p.id === projectId)
  const projectExplorations = state.explorations.filter(e => e.project_id === projectId)
  const exploration = projectExplorations.find(e => e.id === explorationId) || projectExplorations.find(e => !e.parent_id)
  const cards = state.cards.filter(c => c.exploration_id === exploration?.id)
  const rounds = state.rounds.filter(r => r.exploration_id === exploration?.id)
  const belongsToProject = (p: Item) => p.kind === 'exploration' && state.batches.some(b => b.id === p.batch_id && ((b.source_type === 'message' && state.runs.some(r => r.message_id === b.source_id && r.project_id === projectId)) || (b.source_type === 'round' && state.rounds.some(r => r.id === b.source_id && projectExplorations.some(e => e.id === r.exploration_id)))))
  const projectProposals = state.proposals.filter(p => p.status === 'pending' && belongsToProject(p))
  const supersededProposals = state.proposals.filter(p => p.status === 'superseded' && belongsToProject(p)).slice(0, 8)
  const explorationRecords = state.records.filter(record => record.exploration_id === exploration?.id)
  const artifactProposals = state.proposals.filter(proposal => { if (proposal.status !== 'pending' || !['decision','adr','fdr'].includes(proposal.kind)) return false; try { return JSON.parse(proposal.payload).exploration_id === exploration?.id } catch { return false } })
  const activeCard = cards.find(c => c.id === selectedCardId)
  const mainMessageIds = new Set(mainMessages.map(m => m.id))
  const cardMessageIds = new Set(messages.map(m => m.id))
  const mainRun = state.runs.find(r => r.status === 'running' && mainMessageIds.has(r.message_id))
  const cardRun = state.runs.find(r => r.status === 'running' && cardMessageIds.has(r.message_id))
  const mainActionKey = mainMessages.some(message => message.role === 'user') ? 'exploration_chat' : 'exploration_initial'

  const loadMessages = useCallback(async (explorationId: string, cardId = '') => {
    if (!explorationId) { setMessages([]); return }
    setMessages(await api('/explorations/' + explorationId + '/messages' + (cardId ? '?card_id=' + encodeURIComponent(cardId) : '?thread=main')))
  }, [])
  const loadMainMessages = useCallback(async (explorationId: string) => {
    if (!explorationId) { setMainMessages([]); return }
    setMainMessages(await api('/explorations/' + explorationId + '/messages?thread=main'))
  }, [])
  const loadContext = useCallback(async (explorationId: string, cardId = '') => {
    if (!explorationId) { setContext(null); return }
    setContext(await api('/explorations/' + explorationId + '/context' + (cardId ? '?card_id=' + encodeURIComponent(cardId) : '')))
  }, [])

  useEffect(() => { load().catch(e => setError(e.message)) }, [load])
  useEffect(() => { setExplorationId(''); setPhase('exploration'); setOverviewOpen(true) }, [projectId])
  useEffect(() => { setSelectedCardId(''); setMessages([]); setMainMessages([]); setDraft(''); setQuestionDraft(''); loadMessages(exploration?.id || '').catch(e => setError(e.message)); loadMainMessages(exploration?.id || '').catch(e => setError(e.message)) }, [exploration?.id, loadMessages, loadMainMessages])
  useEffect(() => { setContext(null); loadContext(exploration?.id || '', selectedCardId).catch(e => setError(e.message)) }, [exploration?.id, selectedCardId, loadContext])
  useEffect(() => { setMainContext(null); if (exploration?.id) api('/explorations/' + exploration.id + '/context').then(setMainContext).catch(e => setError(e.message)) }, [exploration?.id])
  useEffect(() => {
    if (!state.runs.some(r => r.status === 'running')) return
    const timer = window.setInterval(() => { load().then(() => { if (exploration?.id) { loadMainMessages(exploration.id); loadMessages(exploration.id, selectedCardId) } }).catch(() => {}) }, 2000)
    return () => window.clearInterval(timer)
  }, [state.runs, load, loadMessages, loadMainMessages, exploration?.id, selectedCardId])

  const createProject = async (event: React.FormEvent) => {
    event.preventDefault()
    const name = projectName.trim()
    if (!name) return
    setBusy(true); setError(''); setNotice('')
    try {
      const created = await api('/projects', 'POST', { name })
      const next: State = await api('/state')
      setState(next); setProjectId(created.id)
      await loadMessages(created.exploration_id)
      setProjectName(''); setDialog(null); setNotice('Proyecto creado con su Exploración inicial.')
    } catch (e) { setError((e as Error).message) }
    finally { setBusy(false) }
  }
  const createQuestion = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!exploration) return
    setBusy(true); setError('')
    try {
      await api('/cards', 'POST', { exploration_id: exploration.id, question: question.trim(), reason: reason.trim() })
      await load(); await loadContext(exploration.id); setQuestion(''); setReason(''); setDialog(null)
    } catch (e) { setError((e as Error).message) }
    finally { setBusy(false) }
  }
  const send = async (cardId = selectedCardId) => {
    const body = (cardId ? questionDraft : draft).trim()
    if (!body || !exploration) return
    setBusy(true); setError(''); setNotice('')
    try {
      const result = await api('/explorations/' + exploration.id + '/messages', 'POST', { body, card_id: cardId || undefined })
      if (cardId) setQuestionDraft(''); else setDraft('')
      await load(); await loadMessages(exploration.id, cardId); await loadMainMessages(exploration.id); await loadContext(exploration.id, cardId)
      if (!result.run_id) setNotice('Mensaje guardado. No se inició una ejecución de modelo.')
    } catch (e) { setError((e as Error).message) }
    finally { setBusy(false) }
  }
  const updateCard = async (id: string, status: string) => {
    setError('')
    try { await api('/cards/' + id, 'PATCH', { status }); await load(); await loadContext(exploration?.id || '', selectedCardId) }
    catch (e) { setError((e as Error).message) }
  }
  const closeRound = async (id: string) => {
    try { await api('/rounds/' + id + '/close', 'POST', {}); await load(); await loadMessages(exploration?.id || '', selectedCardId); await loadContext(exploration?.id || '', selectedCardId) }
    catch (e) { setError((e as Error).message) }
  }
  const createExploration = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!exploration || !explorationTitle.trim() || !explorationPurpose.trim()) return
    setBusy(true); setError('')
    try {
      const created = await api('/explorations', 'POST', { title: explorationTitle.trim(), purpose: explorationPurpose.trim(), parent_id: exploration.id, origin_record_id: originRecordId || undefined })
      await load(); setExplorationId(created.id); setPhase('exploration'); setExplorationTitle(''); setExplorationPurpose(''); setOriginRecordId(''); setDialog(null)
    } catch (e) { setError((e as Error).message) }
    finally { setBusy(false) }
  }
  const analyzeRound = async (id: string) => {
    try { await api('/rounds/' + id + '/analyze', 'POST', {}); await load(); setNotice('Revisión de la ronda iniciada.') }
    catch (e) { setError((e as Error).message) }
  }
  const resolveProposal = async (proposal: Item, choice: 'accepted' | 'discarded') => {
    try {
      await api('/batches/' + proposal.batch_id + '/resolve', 'POST', { choices: { [proposal.id]: choice } })
      await load()
      setNotice(choice === 'accepted' ? 'Nueva línea de exploración creada.' : 'Propuesta descartada.')
    } catch (e) { await load().catch(() => {}); setError((e as Error).message) }
  }
  const retry = async (id: string) => {
    setError('')
    try { await api('/messages/' + id + '/retry', 'POST'); await load() }
    catch (e) { setError((e as Error).message) }
  }
  const deleteProject = async (item: Item) => {
    if (!window.confirm(`¿Borrar el proyecto «${item.name}» y todo su contenido? Esta acción no se puede deshacer.`)) return
    setBusy(true); setError(''); setNotice('')
    try {
      await api('/projects/' + encodeURIComponent(item.id), 'DELETE')
      setMessages([]); setProjectId('')
      await load()
      setNotice(`Proyecto «${item.name}» borrado.`)
    } catch (e) { setError((e as Error).message) }
    finally { setBusy(false) }
  }

  return <div className="app project-app">
    <header className="app-header">
      <div className="brandmark"><span className="brand-symbol">D</span><span><strong>DEMIURGO</strong><small>Copiloto de diseño</small></span></div>
      <div className="header-tools"><button className="model-settings-button" onClick={() => setAISettingsOpen(true)}>Modelos y proveedores</button>{project && <button className="model-settings-button quiet" onClick={() => setOpenRuns('')}>Ejecuciones</button>}</div>
    </header>
    {error && <div className="alert error" role="alert"><span>{error}</span><button onClick={() => setError('')}>Cerrar</button></div>}
    {notice && <div className="alert notice" role="status"><span>{notice}</span><button onClick={() => setNotice('')}>Cerrar</button></div>}
    <div className={'workspace project-workspace ' + (activeCard ? 'has-open-question' : '')}>
      <aside className="sidebar project-sidebar">
        <div className="sidebar-heading"><span>Proyectos</span><button aria-label="Crear proyecto" title="Crear proyecto" onClick={() => setDialog('project')}>+</button></div>
        {state.projects.length ? state.projects.map(item => <div key={item.id}><div className={'project-entry ' + (projectId === item.id ? 'selected' : '')}><button className="subject" onClick={() => { setProjectId(item.id); setOverviewOpen(true) }}><span className="subject-title">{item.name}</span></button><button className="delete-project" aria-label={`Borrar proyecto ${item.name}`} title="Borrar proyecto" disabled={busy} onClick={() => deleteProject(item)}>×</button></div>{projectId === item.id && <nav className="exploration-nav" aria-label="Exploraciones del proyecto"><button className={overviewOpen ? 'selected' : ''} onClick={() => setOverviewOpen(true)}>Vista del proyecto</button><span>Exploraciones</span>{projectExplorations.map(line => <button key={line.id} className={!overviewOpen && exploration?.id === line.id ? 'selected' : ''} onClick={() => { setExplorationId(line.id); setSelectedCardId(''); setPhase('exploration'); setOverviewOpen(false) }}>{line.parent_id ? '↳ ' : ''}{line.title}</button>)}</nav>}</div>) : <p className="sidebar-empty">Todavía no hay proyectos.</p>}
        <div className="sidebar-bottom"><button className="primary full" onClick={() => setDialog('project')}>Crear proyecto</button></div>
      </aside>
      <main className="main project-main">
        {project && overviewOpen && <ProjectOverview projectId={project.id} revision={state} onError={setError} onExplore={(id, cardId) => { setExplorationId(id); setPhase('exploration'); setOverviewOpen(false); if (cardId) window.setTimeout(() => { setSelectedCardId(cardId); loadMessages(id, cardId) }, 0) }} onRecord={(id, kind, recordId) => { setExplorationId(id); setFocusRecordId(recordId); setPhase(kind === 'decision' ? 'decision' : 'design'); setOverviewOpen(false) }}/>} 
        {project && exploration && !overviewOpen && <nav className="phase-nav" aria-label="Fases de la exploración"><button className={phase === 'exploration' ? 'active' : ''} onClick={() => setPhase('exploration')}>Exploración</button><button className={phase === 'decision' ? 'active' : ''} onClick={() => setPhase('decision')}>Decisiones <small>{explorationRecords.filter(r => r.kind === 'decision' && r.status === 'draft').length} borradores · {explorationRecords.filter(r => r.kind === 'decision' && r.status === 'approved').length} aprobadas</small></button><button className={phase === 'design' ? 'active' : ''} onClick={() => setPhase('design')}>Diseños ADR/FDR <small>{explorationRecords.filter(r => r.kind === 'adr' || r.kind === 'fdr').length}</small></button><button className={phase === 'implementation' ? 'active' : ''} onClick={() => setPhase('implementation')}>Implementación</button><button className={phase === 'review' ? 'active' : ''} onClick={() => setPhase('review')}>Revisión</button></nav>}
        {!overviewOpen && project && exploration && (phase === 'decision' || phase === 'design') ? <Artifacts exploration={exploration} initialRecordId={focusRecordId} records={explorationRecords} proposals={artifactProposals} phase={phase} onChanged={load} onError={setError} onExplore={record => { setOriginRecordId(record.id); setExplorationTitle(''); setDialog('exploration') }}/> : !overviewOpen && project && exploration && (phase === 'implementation' || phase === 'review') ? <div className="phase-upcoming"><p className="breadcrumb">{project.name} / {exploration.title}</p><h1>{phase === 'implementation' ? 'Implementación' : 'Revisión'}</h1><p>Esta fase llegará después de completar los artefactos de exploración, decisión y diseño del MVP.</p><button onClick={() => { setOriginRecordId(''); setExplorationTitle(''); setDialog('exploration') }}>Abrir nueva exploración</button></div> : !overviewOpen && project && exploration && phase === 'exploration' ? (activeCard ? <>
          <div className="subject-head project-head split-project-head"><div><p className="breadcrumb">{project.name} / {exploration.title}</p><h1>Conversación y pregunta</h1><p className="subject-meta">El hilo original y la pregunta avanzan en paralelo, con contexto independiente.</p></div><button className="ghost" onClick={() => { setSelectedCardId(''); loadMessages(exploration.id); loadContext(exploration.id) }}>Volver a la exploración</button></div>
          <nav className="question-switcher" aria-label="Preguntas de esta exploración"><span>Preguntas</span>{cards.map(item => <button key={item.id} className={item.id === selectedCardId ? 'selected' : ''} onClick={() => { setSelectedCardId(item.id); setQuestionDraft(''); loadMessages(exploration.id, item.id) }}>{item.question}</button>)}</nav>
          <div className="conversation-split">
            <ConversationPane api={api} scopeType="exploration" scopeId={exploration.id} actionKey={mainActionKey} title="Conversación original" subtitle={exploration.parent_id ? 'Origen y desarrollo de esta línea' : 'Visión y decisiones de la exploración'} messages={mainMessages} runs={state.runs} draft={draft} onDraft={setDraft} onSend={() => send('')} onRetry={retry} onRun={setOpenRuns} busy={busy} activeRun={mainRun} context={<ExplorationContext context={mainContext} onParent={id => { setExplorationId(id); setSelectedCardId('') }}/> } emptyTitle="La exploración todavía no tiene mensajes" emptyText="Escribe aquí para conservar el contexto original junto a la pregunta."/>
            <ConversationPane api={api} scopeType="card" scopeId={activeCard.id} actionKey="question_response" title={activeCard.question} subtitle={activeCard.status === 'confirmed' ? 'Pregunta confirmada' : 'Pregunta abierta'} messages={messages} runs={state.runs} draft={questionDraft} onDraft={setQuestionDraft} onSend={() => send(activeCard.id)} onRetry={retry} onRun={setOpenRuns} busy={busy} activeRun={cardRun} card={activeCard} originText={context?.card_origin_text || mainContext?.origin_text} emptyTitle="Responde a la pregunta" emptyText="El motivo y el texto que la originó están encima de este hilo."/>
          </div>
        </> : <>
          <div className="subject-head project-head"><div><p className="breadcrumb">{project.name} / Exploración</p><h1>{exploration.title}</h1><p className="subject-meta">{exploration.parent_id ? 'Línea de exploración derivada' : 'Proceso de exploración de este proyecto'}</p></div><div className="head-actions"><button className="ghost" onClick={() => { setOriginRecordId(''); setExplorationTitle(''); setDialog('exploration') }}>+ Nueva exploración</button><button className="ghost" onClick={() => setDialog('question')}>+ Añadir pregunta</button></div></div>
          <ConversationPane api={api} scopeType="exploration" scopeId={exploration.id} actionKey={mainActionKey} title="Conversación de exploración" subtitle={exploration.parent_id ? 'Una línea de trabajo dentro de este proyecto' : 'La visión, las preguntas y las conclusiones del proyecto'} messages={mainMessages} runs={state.runs} draft={draft} onDraft={setDraft} onSend={() => send('')} onRetry={retry} onRun={setOpenRuns} busy={busy} activeRun={mainRun} context={<ExplorationContext context={mainContext} onParent={id => { setExplorationId(id); setSelectedCardId('') }}/>} emptyTitle={exploration.parent_id ? 'Empieza esta línea de exploración' : 'Empieza por la idea general'} emptyText={exploration.parent_id ? 'Desarrolla lo que falta resolver en esta línea. Su motivo y procedencia se muestran aquí.' : 'Cuéntame qué producto queremos construir, para quién y qué necesidad debería resolver.'}/>
        </>) : !project ? <div className="welcome project-welcome"><div className="welcome-mark">D</div><h1>Un espacio para cada producto.</h1><p>Crea un proyecto para empezar a explorar la idea general de lo que queremos construir.</p><button className="primary" onClick={() => setDialog('project')}>Crear primer proyecto</button></div> : null}
      </main>
      {project && exploration && !overviewOpen && phase === 'exploration' && !activeCard && <aside className="inbox project-questions"><div className="inbox-head"><h2>Preguntas</h2><span>{cards.length}</span></div><button className="ghost full" onClick={() => setDialog('question')}>+ Añadir pregunta</button>
        {projectProposals.length > 0 && <section className="proposals-panel"><h3>Nuevas líneas propuestas</h3><p className="proposal-intro">Cada línea conserva la respuesta o ronda de la que surgió. Tú decides cuáles abrir.</p><div className="proposal-grid">{projectProposals.map(p => { const payload = JSON.parse(p.payload); const sourceCards = state.cards.filter(c => c.round_id === payload.round_id && c.status === 'confirmed'); const parent = projectExplorations.find(e => e.id === payload.parent_id); return <div className="inbox-item" key={p.id}><span className="badge pending">Propuesta pendiente</span><h4>{payload.title}</h4><p className="proposal-purpose">{payload.body}</p><div className="proposal-origin"><strong>De dónde viene</strong><span>{payload.round_id ? `Ronda de «${parent?.title || 'Exploración'}»` : `Conversación de «${parent?.title || 'Exploración'}»`}</span>{sourceCards.map(c => <span key={c.id}>{c.question} — {c.conclusion}</span>)}</div><div className="item-actions"><button onClick={() => resolveProposal(p, 'accepted')}>Abrir línea</button><button onClick={() => resolveProposal(p, 'discarded')}>Descartar</button></div></div> })}</div></section>}
        {supersededProposals.length > 0 && <details className="superseded-proposals"><summary>Propuestas sustituidas ({supersededProposals.length})</summary><p>Una respuesta posterior cambió su contexto. Se conservan como antecedentes y ya no se pueden aceptar.</p>{supersededProposals.map(p => { const payload = JSON.parse(p.payload); return <article key={p.id}><strong>{payload.title}</strong><span>{payload.body}</span></article> })}</details>}
        {rounds.map(item => { const roundRuns = state.runs.filter(r => r.round_id === item.id); const running = roundRuns.some(r => r.status === 'running'); const currentReview = roundRuns[0]?.status === 'completed' && roundRuns[0]?.method_version === state.codex_method_version; return <div className="round-panel" key={item.id}><strong>Ronda {item.status === 'closed' ? 'cerrada' : 'abierta'}</strong>{item.status === 'open' ? <button onClick={() => closeRound(item.id)}>Cerrar ronda</button> : !running && !currentReview && <button onClick={() => analyzeRound(item.id)}>{roundRuns.some(r => r.status === 'completed') ? 'Revisar con método actualizado' : 'Revisar y proponer líneas'}</button>}{roundRuns.map(run => <button key={run.id} onClick={() => setOpenRuns(run.id)}>Ver análisis de ronda · {run.status}</button>)}</div> })}
        {cards.length ? <div className="question-card-grid">{cards.map(item => <div className="inbox-item" key={item.id}><span className="badge pending">{item.status === 'inferred' ? 'Conclusión inferida' : item.status === 'confirmed' ? 'Confirmada' : item.status === 'deferred' ? 'Pospuesta' : item.status === 'discarded' ? 'Descartada' : 'Abierta'}</span><h4>{item.question}</h4>{item.reason && <p>{item.reason}</p>}<button onClick={() => { setSelectedCardId(item.id); loadMessages(exploration.id, item.id) }}>Abrir conversación</button>{item.conclusion && <p><strong>Conclusión:</strong> {item.conclusion}</p>}{item.status === 'pending' && <div className="item-actions"><button onClick={() => updateCard(item.id, 'confirmed')}>Confirmar</button><button onClick={() => updateCard(item.id, 'deferred')}>Posponer</button></div>}{item.status === 'inferred' && <button onClick={() => updateCard(item.id, 'confirmed')}>Confirmar inferencia</button>}{item.round_id && state.rounds.find(r => r.id === item.round_id)?.status === 'open' && <button onClick={() => closeRound(item.round_id)}>Cerrar ronda</button>}</div>)}</div> : <div className="empty"><strong>Aún no hay preguntas</strong><p>Añade aquí una pregunta que quieras tener presente mientras exploramos la idea.</p></div>}
      </aside>}
    </div>
    {dialog && <div className="overlay" onMouseDown={e => { if (e.target === e.currentTarget) setDialog(null) }}><div className="dialog" role="dialog" aria-modal="true" aria-label={dialog === 'project' ? 'Crear proyecto' : dialog === 'exploration' ? 'Abrir exploración' : 'Añadir pregunta'}><div className="dialog-head"><h2>{dialog === 'project' ? 'Crear proyecto' : dialog === 'exploration' ? 'Abrir exploración' : 'Añadir pregunta'}</h2><button aria-label="Cerrar" onClick={() => setDialog(null)}>×</button></div>
      {dialog === 'project' ? <form onSubmit={createProject}><label className="field"><span>Nombre del proyecto</span><input autoFocus value={projectName} onChange={e => setProjectName(e.target.value)} required/></label><p className="form-note">Se creará con una sección «Exploración inicial».</p><div className="dialog-actions"><button type="button" onClick={() => setDialog(null)}>Cancelar</button><button className="primary" type="submit" disabled={busy || !projectName.trim()}>Crear</button></div></form> : dialog === 'exploration' ? <form onSubmit={createExploration}><p className="form-note">Nueva línea dentro de «{project?.name}», derivada de «{exploration?.title}»{originRecordId ? ' y vinculada al artefacto seleccionado' : ''}.</p><label className="field"><span>Qué necesitamos explorar</span><input autoFocus value={explorationTitle} onChange={e => setExplorationTitle(e.target.value)} required/></label><label className="field"><span>Por qué se abre y qué falta resolver</span><textarea value={explorationPurpose} onChange={e => setExplorationPurpose(e.target.value)} required/></label><div className="dialog-actions"><button type="button" onClick={() => setDialog(null)}>Cancelar</button><button className="primary" disabled={busy || !explorationTitle.trim() || !explorationPurpose.trim()}>Abrir exploración</button></div></form> : <form onSubmit={createQuestion}><label className="field"><span>Pregunta</span><input autoFocus value={question} onChange={e => setQuestion(e.target.value)} required/></label><label className="field"><span>Por qué aparece</span><textarea value={reason} onChange={e => setReason(e.target.value)} required/></label><div className="dialog-actions"><button type="button" onClick={() => setDialog(null)}>Cancelar</button><button className="primary" type="submit" disabled={busy || !question.trim() || !reason.trim()}>Guardar</button></div></form>}
    </div></div>}
    {aiSettingsOpen && <AISettings api={api} onClose={() => setAISettingsOpen(false)}/>}
    {openRuns !== null && projectId && <Runs projectId={projectId} initialRunId={openRuns || undefined} onClose={() => setOpenRuns(null)}/>}
  </div>
}
