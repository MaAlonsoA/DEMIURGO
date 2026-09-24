type Item = Record<string, any>

function OriginText({ text }: { text: string }) {
  if (!text) return null
  const short = text.length > 420 ? text.slice(0, 420).trimEnd() + '…' : text
  return <div className="context-origin"><p>{short}</p>{text.length > 420 && <details><summary>Leer el mensaje completo</summary><p>{text}</p></details>}</div>
}

export default function ExplorationContext({ context, onParent }: { context: Item | null, onParent: (id: string) => void }) {
  if (!context) return null
  const card = context.card
  const parent = context.parent
  return <section className="exploration-context" aria-label={card ? 'Contexto de la pregunta' : 'Contexto de la exploración'}>
    <div className="context-title"><h2>{card ? 'Contexto de esta pregunta' : 'Cómo nació esta exploración'}</h2><span>{card ? 'Pregunta' : parent ? 'Línea derivada' : 'Exploración inicial'}</span></div>
    {card ? <>
      <p className="context-lead">{card.reason || 'Esta pregunta se añadió para aclarar un punto de la exploración.'}</p>
      <p className="context-trail">Pertenece a «{context.exploration.title}» · Estado: {card.status === 'confirmed' ? 'confirmada por la persona' : card.status === 'inferred' ? 'conclusión inferida' : card.status === 'deferred' ? 'pospuesta' : card.status === 'discarded' ? 'descartada' : 'abierta'}</p>
      {card.conclusion && <div className="context-finding"><strong>Conclusión actual</strong><p>{card.conclusion}</p></div>}
      {context.card_origin_text && <details className="context-source"><summary>Mensaje que originó la pregunta</summary><OriginText text={context.card_origin_text}/></details>}
    </> : <>
      {parent ? <p className="context-trail">Nació de <button type="button" onClick={() => onParent(parent.id)}>{parent.title}</button>{context.origin_kind === 'proposal' ? ' · Propuesta aceptada por la persona' : context.origin_kind === 'record' ? ' · Abierta desde un diseño o decisión' : ' · Abierta manualmente'}</p> : <p className="context-trail">Se creó junto al proyecto. Aquí empieza su conversación.</p>}
      {context.purpose && <div className="context-finding"><strong>Qué necesitamos resolver</strong><p>{context.purpose}</p></div>}
      {context.origin_review && <div className="context-review" role="note"><strong>El contexto de origen cambió después</strong><p>Esta línea fue aceptada antes de una respuesta posterior. Conviene comprobar si su alcance sigue encajando; la aceptación se conserva.</p><details><summary>Leer la respuesta posterior</summary><OriginText text={context.origin_review.latest_text}/></details></div>}
      {context.origin_record && <p className="context-lead">Partió del artefacto «{context.origin_record.title}».</p>}
      {context.origin_cards?.length > 0 && <div className="context-finding"><strong>Respuestas confirmadas en la ronda de origen</strong>{context.origin_cards.map((item: Item, index: number) => <p key={index}>{item.question}<br/><strong>Respuesta:</strong> {item.conclusion}</p>)}</div>}
      {context.origin_question && <div className="context-finding"><strong>Pregunta de origen</strong><p>{context.origin_question}</p></div>}
      {context.origin_text && <details className="context-source"><summary>{parent ? 'Leer la respuesta de origen' : 'Leer la visión inicial'}</summary><OriginText text={context.origin_text}/></details>}
      {context.confirmed?.length > 0 && <div className="context-known"><strong>Ya confirmado en esta exploración</strong>{context.confirmed.map((item: Item) => <p key={item.id}>{item.conclusion}</p>)}</div>}
    </>}
  </section>
}
