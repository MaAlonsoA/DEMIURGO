import React from 'react'
import ReactMarkdown from 'react-markdown'
import TaskModelSelector from './TaskModelSelector'

type Item = Record<string, any>
type Api = (path: string, method?: string, body?: unknown) => Promise<any>
type Props = {
  api: Api
  scopeType: 'exploration' | 'card'
  scopeId: string
  actionKey: string
  title: string
  subtitle?: string
  messages: Item[]
  runs: Item[]
  draft: string
  onDraft: (value: string) => void
  onSend: () => void
  onRetry: (messageId: string) => void
  onRun: (runId: string) => void
  busy: boolean
  context?: React.ReactNode
  activeRun?: Item
  card?: Item
  originText?: string
  emptyTitle: string
  emptyText: string
}

export default function ConversationPane({ api, scopeType, scopeId, actionKey, title, subtitle, messages, runs, draft, onDraft, onSend, onRetry, onRun, busy, context, activeRun, card, originText, emptyTitle, emptyText }: Props) {
  return <section className={'conversation-view conversation-pane ' + (card ? 'question-pane' : 'main-pane')}>
    <header className="thread-panel-head"><div><span>{card ? 'Pregunta abierta' : 'Conversación'}</span><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div></header>
    {card && <div className="question-origin"><strong>Por qué apareció esta pregunta</strong><p>{card.reason || 'La conversación dejó una decisión pendiente que puede cambiar el alcance del producto.'}</p>{originText && <details><summary>Ver de dónde surgió</summary><div className="question-origin-text"><ReactMarkdown>{originText}</ReactMarkdown></div></details>}</div>}
    <div className="message-list pane-messages">
      {context}
      {messages.length ? messages.map(message => <article key={message.id} className={'message ' + message.role}>
        <div className="message-author">{message.role === 'user' ? 'Tú' : 'DEMIURGO'}</div><div className="message-body"><ReactMarkdown>{message.body}</ReactMarkdown></div><time>{new Date(message.created_at).toLocaleString('es-ES')}</time>
        {message.role === 'user' && runs.filter(run => run.message_id === message.id).map(run => <div className="run-error" key={run.id}><button className="run-link" onClick={() => onRun(run.id)}>Análisis #{run.attempt} · {run.status}</button>{['failed', 'cancelled', 'interrupted'].includes(run.status) && <> · {run.error || 'Sin respuesta'} <button onClick={() => onRetry(message.id)}>Reintentar</button></>}</div>)}
      </article>) : <div className="empty project-empty"><strong>{emptyTitle}</strong><p>{emptyText}</p></div>}
      {activeRun && <div className="run-status"><span className="spinner"></span> DEMIURGO está pensando con {activeRun.provider === 'qwen' ? 'Qwen' : 'Codex'} · {activeRun.requested_model} · {activeRun.reasoning_effort}</div>}
    </div>
    <div className="composer pane-composer">
      <TaskModelSelector api={api} scopeType={scopeType} scopeId={scopeId} actionKey={actionKey}/>
      <textarea value={draft} onChange={e => onDraft(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); onSend() } }} placeholder={card ? 'Responde a esta pregunta' : 'Continúa la exploración'} aria-label="Mensaje"/>
      <div className="composer-foot"><small>Ctrl + Enter para enviar</small><button className="primary" onClick={onSend} disabled={busy || !draft.trim()}>Enviar</button></div>
    </div>
  </section>
}
