import { useEffect, useState } from 'react'

type Item = Record<string, any>
type Api = (path: string, method?: string, body?: unknown) => Promise<any>
type Props = { api: Api; onClose: () => void }
type Draft = { provider: string; model: string; reasoning_effort: string; base_url: string }
const defaults: Record<string, Draft> = {
  exploration_initial: { provider: 'codex', model: 'gpt-6-sol', reasoning_effort: 'high', base_url: '' },
  exploration_chat: { provider: 'codex', model: 'gpt-6-luna', reasoning_effort: 'medium', base_url: '' },
  question_response: { provider: 'codex', model: 'gpt-6-sol', reasoning_effort: 'high', base_url: '' },
  round_review: { provider: 'codex', model: 'gpt-6-sol', reasoning_effort: 'high', base_url: '' },
  source_analysis: { provider: 'codex', model: 'gpt-6-sol', reasoning_effort: 'high', base_url: '' },
  categorization: { provider: 'codex', model: 'gpt-6-luna', reasoning_effort: 'medium', base_url: '' },
}

export default function AISettings({ api, onClose }: Props) {
  const [actions, setActions] = useState<Item[]>([])
  const [providers, setProviders] = useState<Item[]>([])
  const [drafts, setDrafts] = useState<Record<string, Draft>>({})
  const [models, setModels] = useState<Record<string, string[]>>({})
  const [status, setStatus] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')

  const load = async () => {
    const result = await api('/ai/settings')
    setActions(result.actions || [])
    setProviders(result.providers || [])
    setDrafts(Object.fromEntries((result.actions || []).map((action: Item) => [action.key, {
      provider: action.provider,
      model: action.model,
      reasoning_effort: action.reasoning_effort,
      base_url: action.base_url || '',
    }])))
  }
  useEffect(() => { load().catch(e => setError((e as Error).message)) }, [])

  const update = (key: string, patch: Partial<Draft>) => setDrafts(current => ({ ...current, [key]: { ...current[key], ...patch } }))
  const switchProvider = (key: string, provider: string) => {
    const was = drafts[key]
    update(key, {
      provider,
      model: provider === 'qwen' ? 'qwen3.8-27b' : (was?.model.startsWith('gpt-') ? was.model : 'gpt-6-sol'),
      reasoning_effort: provider === 'qwen' ? 'xhigh' : 'high',
      base_url: provider === 'qwen' ? (was?.provider === 'qwen' && was.base_url ? was.base_url : 'http://host.docker.internal:8080/v1') : '',
    })
  }

  const discover = async (key: string) => {
    setBusy(key); setError('')
    try {
      const profile = drafts[key]
      const result = await api(`/ai/models?provider=qwen&base_url=${encodeURIComponent(profile.base_url || 'http://host.docker.internal:8080/v1')}`)
      setModels(current => ({ ...current, [key]: result.models || [] }))
      if (!profile.model && result.models?.[0]) update(key, { model: result.models[0] })
      setStatus(current => ({ ...current, [key]: result.models?.length ? `Detectado: ${result.models.join(', ')}` : 'Conectado; no se anunciaron modelos.' }))
    } catch (e) { setError((e as Error).message) }
    finally { setBusy('') }
  }

  const save = async (key: string) => {
    setBusy(key); setError('')
    try { await api(`/ai/settings/${key}`, 'PUT', drafts[key]); setStatus(current => ({ ...current, [key]: 'Perfil guardado.' })) }
    catch (e) { setError((e as Error).message) }
    finally { setBusy('') }
  }

  const test = async (key: string) => {
    setBusy(key); setError('')
    try {
      const profile = drafts[key]
      const result = await api('/ai/providers/test', 'POST', { provider: profile.provider, base_url: profile.base_url, model: profile.model, reasoning_effort: profile.reasoning_effort })
      setStatus(current => ({ ...current, [key]: result.message }))
      if (profile.provider === 'qwen' && result.models?.length) setModels(current => ({ ...current, [key]: result.models }))
    } catch (e) { setError((e as Error).message) }
    finally { setBusy('') }
  }

  const modelOptions: Record<string, string[]> = { codex: ['low', 'medium', 'high', 'xhigh'], qwen: ['low', 'medium', 'xhigh'] }
  return <div className="overlay ai-settings-overlay" onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
    <section className="ai-settings-dialog" role="dialog" aria-modal="true" aria-labelledby="ai-settings-title">
      <header className="ai-settings-head"><div><p>Preferencias de inteligencia</p><h2 id="ai-settings-title">Modelos por acción</h2><span>Configura qué proveedor utiliza cada parte de DEMIURGO. Las conversaciones pueden guardar una selección propia.</span></div><button aria-label="Cerrar" onClick={onClose}>×</button></header>
      <div className="ai-provider-strip">{providers.map(provider => <div key={provider.key}><span className={'provider-mark ' + provider.key}>{provider.key === 'qwen' ? 'Q' : 'C'}</span><strong>{provider.label}</strong><small>{provider.key === 'qwen' ? 'OpenAI compatible · local' : provider.available ? 'CLI conectada' : 'CLI no detectada'}</small></div>)}</div>
      {error && <div className="alert error" role="alert">{error}<button onClick={() => setError('')}>Cerrar</button></div>}
      <div className="ai-action-list">{actions.map(action => {
        const draft = drafts[action.key] || defaults[action.key]
        const efforts = modelOptions[draft?.provider] || modelOptions.codex
        return <article className={'ai-action-row ' + (!action.active ? 'inactive' : '')} key={action.key}>
          <div className="ai-action-copy"><div><h3>{action.label}</h3>{!action.active && <span className="future-badge">En preparación</span>}</div><p>{action.description}</p></div>
          <div className="ai-action-fields">
            <label><span>Proveedor</span><select value={draft?.provider || 'codex'} onChange={e => switchProvider(action.key, e.target.value)}><option value="codex">Codex</option><option value="qwen">Qwen local</option></select></label>
            {draft?.provider === 'qwen' && <label className="base-url-field"><span>Dirección local</span><input value={draft.base_url} onChange={e => update(action.key, { base_url: e.target.value })} spellCheck={false}/></label>}
            <label className="model-field"><span>Modelo</span><input list={`models-${action.key}`} value={draft?.model || ''} onChange={e => update(action.key, { model: e.target.value })} spellCheck={false}/><datalist id={`models-${action.key}`}>{(models[action.key] || []).map(model => <option key={model} value={model}/>)}</datalist></label>
            <label><span>Esfuerzo</span><select value={draft?.reasoning_effort || 'medium'} onChange={e => update(action.key, { reasoning_effort: e.target.value })}>{efforts.map(effort => <option key={effort} value={effort}>{effort}</option>)}</select></label>
          </div>
          <div className="ai-action-footer">{draft?.provider === 'qwen' && <button className="text-action" onClick={() => discover(action.key)} disabled={busy === action.key}>Detectar modelos</button>}<span role="status">{status[action.key] || ''}</span>{draft?.provider === 'qwen' && <button onClick={() => test(action.key)} disabled={busy === action.key}>Probar conexión</button>}<button className="primary" onClick={() => save(action.key)} disabled={busy === action.key || !draft?.model?.trim()}>{busy === action.key ? 'Guardando…' : 'Guardar perfil'}</button></div>
        </article>
      })}</div>
      <footer className="ai-settings-foot"><p>Qwen ofrece `low`, `medium` y `xhigh` en el servidor local actual. Codex ofrece `low`, `medium`, `high` y `xhigh`.</p><button onClick={onClose}>Listo</button></footer>
    </section>
  </div>
}
