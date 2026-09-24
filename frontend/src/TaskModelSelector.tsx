import { useEffect, useState } from 'react'

type Item = Record<string, any>
type Api = (path: string, method?: string, body?: unknown) => Promise<any>
type Props = { api: Api; scopeType: 'exploration' | 'card' | 'source'; scopeId: string; actionKey: string }

const defaultModel = (provider: string) => provider === 'qwen' ? 'qwen3.8-27b' : 'gpt-6-sol'
const defaultEffort = (provider: string) => provider === 'qwen' ? 'xhigh' : 'high'

export default function TaskModelSelector({ api, scopeType, scopeId, actionKey }: Props) {
  const [profile, setProfile] = useState<Item | null>(null)
  const [draft, setDraft] = useState<Item>({})
  const [models, setModels] = useState<string[]>([])
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const load = async () => {
    if (!scopeId) return
    const next = await api(`/ai/selection?scope_type=${scopeType}&scope_id=${encodeURIComponent(scopeId)}&action_key=${actionKey}`)
    setProfile(next)
    setDraft({ provider: next.provider, model: next.model, reasoning_effort: next.reasoning_effort, base_url: next.base_url })
  }

  useEffect(() => {
    let alive = true
    if (scopeId) api(`/ai/selection?scope_type=${scopeType}&scope_id=${encodeURIComponent(scopeId)}&action_key=${actionKey}`)
      .then(next => { if (alive) { setProfile(next); setDraft({ provider: next.provider, model: next.model, reasoning_effort: next.reasoning_effort, base_url: next.base_url }) } })
      .catch(e => { if (alive) setError((e as Error).message) })
    return () => { alive = false }
  }, [scopeType, scopeId, actionKey])

  const setProvider = (provider: string) => setDraft(current => ({
    ...current,
    provider,
    model: provider === current.provider ? current.model : defaultModel(provider),
    reasoning_effort: provider === current.provider ? current.reasoning_effort : defaultEffort(provider),
    base_url: provider === 'qwen' ? (current.provider === 'qwen' ? current.base_url : 'http://host.docker.internal:8080/v1') : '',
  }))

  const discover = async () => {
    setBusy(true); setError('')
    try {
      const result = await api(`/ai/models?provider=qwen&base_url=${encodeURIComponent(draft.base_url || 'http://host.docker.internal:8080/v1')}`)
      setModels(result.models || [])
      if (!draft.model && result.models?.[0]) setDraft(current => ({ ...current, model: result.models[0] }))
    } catch (e) { setError((e as Error).message) }
    finally { setBusy(false) }
  }

  const save = async () => {
    setBusy(true); setError('')
    try {
      await api('/ai/selection', 'PUT', { scope_type: scopeType, scope_id: scopeId, ...draft })
      await load(); setOpen(false)
    } catch (e) { setError((e as Error).message) }
    finally { setBusy(false) }
  }

  const reset = async () => {
    if (!profile) return
    setBusy(true); setError('')
    try {
      const actionDefault = profile.inherited_override ? profile.default : null
      await api('/ai/selection', 'PUT', { scope_type: scopeType, scope_id: scopeId, ...(actionDefault || {}), reset: !actionDefault })
      await load(); setOpen(false)
    } catch (e) { setError((e as Error).message) }
    finally { setBusy(false) }
  }

  if (!profile) return <span className="task-model-loading">Preparando modelo…</span>
  const provider = draft.provider || profile.provider
  const efforts: string[] = provider === 'qwen' ? ['low', 'medium', 'xhigh'] : ['low', 'medium', 'high', 'xhigh']
  return <div className="task-model-picker">
    <button type="button" className="task-model-trigger" aria-expanded={open} onClick={() => { setError(''); setOpen(value => !value) }}>
      <span className={'provider-mark ' + profile.provider}>{profile.provider === 'qwen' ? 'Q' : 'C'}</span>
      <span>{profile.provider === 'qwen' ? 'Qwen local' : 'Codex'} · {profile.model} · {profile.reasoning_effort}</span>
      <span className="task-model-scope">{profile.task_override ? profile.inherited_override ? 'Heredado del chat' : 'Esta tarea' : 'Perfil de acción'}</span>
      <span aria-hidden="true">⌄</span>
    </button>
    {open && <div className="task-model-editor">
      <div className="task-model-editor-head"><strong>Modelo de esta conversación</strong><span>Solo cambia esta exploración</span></div>
      <label><span>Proveedor</span><select value={provider} onChange={e => setProvider(e.target.value)}><option value="codex">Codex</option><option value="qwen">Qwen local</option></select></label>
      {provider === 'qwen' && <label><span>Dirección de Qwen</span><input value={draft.base_url || ''} onChange={e => setDraft(current => ({ ...current, base_url: e.target.value }))} spellCheck={false}/></label>}
      <label><span>Modelo</span><input list={`task-models-${scopeId}`} value={draft.model || ''} onChange={e => setDraft(current => ({ ...current, model: e.target.value }))} spellCheck={false}/><datalist id={`task-models-${scopeId}`}>{models.map(model => <option key={model} value={model}/>)}</datalist></label>
      {provider === 'qwen' && <button type="button" className="text-action" onClick={discover} disabled={busy}>Detectar modelos locales</button>}
      <label><span>Esfuerzo de razonamiento</span><select value={draft.reasoning_effort || defaultEffort(provider)} onChange={e => setDraft(current => ({ ...current, reasoning_effort: e.target.value }))}>{efforts.map(effort => <option key={effort} value={effort}>{effort}</option>)}</select></label>
      {error && <p className="task-model-error" role="alert">{error}</p>}
      <div className="task-model-actions"><button type="button" onClick={reset} disabled={busy || !profile.task_override}>Usar perfil de acción</button><button type="button" className="primary" onClick={save} disabled={busy || !draft.model?.trim()}>{busy ? 'Guardando…' : 'Guardar para esta tarea'}</button></div>
    </div>}
  </div>
}
