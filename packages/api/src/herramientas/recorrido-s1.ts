// Recorrido real de S1 contra un servidor en marcha (con el agente que tenga configurado):
//   node packages/api/src/herramientas/recorrido-s1.ts <url> <usuario> "<intención>" "<mensaje>" ["<mensaje>"…]
// Envía los mensajes de uno en uno hasta que el agente propone una decisión.
// La clave de la persona se lee de la entrada estándar. Actúa como la persona: acepta y
// aprueba explícitamente, igual que haría desde la UI.

const [url = 'http://127.0.0.1:8100', usuario = '', intencion = '', ...mensajes] = process.argv.slice(2);

async function leerClave(): Promise<string> {
  const trozos: Buffer[] = [];
  for await (const t of process.stdin) trozos.push(t as Buffer);
  return Buffer.concat(trozos).toString('utf8').trim();
}

let cookie = '';
let csrf = '';

async function pedir<T>(metodo: string, ruta: string, cuerpo?: unknown): Promise<T> {
  const r = await fetch(`${url}${ruta}`, {
    method: metodo,
    headers: { 'content-type': 'application/json', cookie, 'x-demiurgo-csrf': csrf },
    ...(cuerpo === undefined ? {} : { body: JSON.stringify(cuerpo) }),
  });
  const texto = await r.text();
  if (!r.ok) throw new Error(`${metodo} ${ruta}: ${r.status} ${texto}`);
  return JSON.parse(texto) as T;
}

const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));
type Run = {
  id: string;
  state: string;
  action: string;
  model: string | null;
  usage: unknown;
  failure_kind: string | null;
  error: string | null;
};

async function esperarRun(proyectoId: string, id: string): Promise<Run> {
  for (let i = 0; i < 300; i++) {
    const r = await pedir<Run>('GET', `/api/proyectos/${proyectoId}/runs/${id}`);
    if (!['queued', 'running'].includes(r.state)) return r;
    await esperar(1000);
  }
  throw new Error(`La ejecución ${id} no terminó.`);
}

async function main(): Promise<void> {
  const clave = await leerClave();
  const login = await fetch(`${url}/api/sesion`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ usuario, clave }),
  });
  if (!login.ok) throw new Error(`Inicio de sesión: ${login.status} ${await login.text()}`);
  cookie = (login.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
  csrf = ((await login.json()) as { csrf: string }).csrf;
  const fecha = new Date().toISOString();
  const informe: Record<string, unknown> = { fecha };

  const { proyecto_id: p } = await pedir<{ proyecto_id: string }>('POST', '/api/proyectos', {
    nombre: `Recorrido real S1 ${fecha}`,
  });
  type Respuesta<T> = { entidad_id: string; resultado: T };
  const cmd = <T = unknown>(nombre: string, datos: unknown, entidad?: string): Promise<Respuesta<T>> =>
    pedir<Respuesta<T>>('POST', `/api/proyectos/${p}/comandos/${nombre}`, {
      ...(entidad ? { entidad_id: entidad } : {}),
      datos,
    });

  const e = await cmd('exploration.open', { proposito: intencion });
  type Propuesta = { id: string; tipo: string; carga: unknown };
  const turnos: unknown[] = [];
  let decision: Propuesta | undefined;
  for (const mensaje of mensajes) {
    const antes = (await pedir<{ command: string }[]>('GET', `/api/proyectos/${p}/eventos`)).filter(
      (ev) => ev.command === 'run.request',
    ).length;
    await cmd('message.post', { exploracion_id: e.entidad_id, texto: mensaje });
    let chat: Run | undefined;
    for (let i = 0; i < 180 && !chat; i++) {
      await esperar(1000);
      const pedidos = (await pedir<{ entity_id: string; command: string }[]>('GET', `/api/proyectos/${p}/eventos`)).filter(
        (ev) => ev.command === 'run.request',
      );
      const nuevo = pedidos[antes];
      if (nuevo) chat = await esperarRun(p, nuevo.entity_id);
    }
    const exploracion = await pedir<{
      mensajes: { author: string; body: string; kind: string | null; run_id: string | null }[];
      preguntas: { question: string; state: string }[];
    }>('GET', `/api/proyectos/${p}/exploraciones/${e.entidad_id}`);
    const bandeja = await pedir<{ lotes: { propuestas: Propuesta[] }[] }>('GET', `/api/proyectos/${p}/bandeja`);
    const propuestas = bandeja.lotes.flatMap((l) => l.propuestas);
    turnos.push({
      mensaje,
      ejecucion: chat && {
        id: chat.id,
        estado: chat.state,
        modelo: chat.model,
        uso: chat.usage,
        fallo: chat.failure_kind,
        error: chat.error,
      },
      respuesta: exploracion.mensajes.filter((m) => m.run_id === chat?.id).map((m) => ({ tipo: m.kind, texto: m.body })),
      preguntas: exploracion.preguntas.map((q) => `${q.state}: ${q.question}`),
      propuestas: propuestas.map((x) => ({ tipo: x.tipo, carga: x.carga })),
    });
    decision = propuestas.find((x) => x.tipo === 'decision');
    if (decision) break;
  }
  informe.turnos = turnos;
  if (!decision) {
    informe.resultado = 'El agente no propuso ninguna decisión: el recorrido se detiene aquí.';
    console.log(JSON.stringify(informe, null, 2));
    return;
  }
  const aceptada = await cmd<{ codigo: string; versionId: string }>('proposal.accept', { aprobar: true }, decision.id);
  const diseno = await cmd<{ runId: string }>('run.request', {
    accion: 'design_proposal',
    alcance: { tipo: 'record_version', id: aceptada.resultado.versionId },
  });
  informe.design_proposal = await esperarRun(p, diseno.entidad_id);
  const b2 = await pedir<{ lotes: { id: string; tipo: string; propuestas: { carga: unknown }[] }[] }>(
    'GET',
    `/api/proyectos/${p}/bandeja`,
  );
  const paquete = b2.lotes.find((l) => l.tipo === 'system_package');
  if (!paquete) throw new Error('No llegó el paquete de diseño.');
  informe.fdr_propuesta = paquete.propuestas[0]?.carga;
  const acept = await cmd<{ efectos: { codigo: string; versionId: string }[] }>('batch.accept_package', {}, paquete.id);
  const fdr = acept.resultado.efectos[0];
  await cmd('record_version.approve', {}, fdr?.versionId);
  informe.readiness_tras_aprobar = await pedir('GET', `/api/proyectos/${p}/versiones/${fdr?.versionId}/readiness`);
  // Cierre explícito de la persona: las preguntas abiertas quedan resueltas por la decisión y
  // las propuestas sobrantes se rechazan con su motivo. Nada de esto lo hace un agente.
  const motivo = `Resuelta por la decisión ${aceptada.resultado.codigo}.`;
  const exploracionFinal = await pedir<{ preguntas: { id: string; state: string }[] }>(
    'GET',
    `/api/proyectos/${p}/exploraciones/${e.entidad_id}`,
  );
  for (const q of exploracionFinal.preguntas.filter((x) => ['pending', 'inferred', 'postponed'].includes(x.state))) {
    await cmd('question.discard', { motivo }, q.id);
  }
  const restantes = await pedir<{ lotes: { propuestas: { id: string }[] }[] }>('GET', `/api/proyectos/${p}/bandeja`);
  for (const x of restantes.lotes.flatMap((l) => l.propuestas)) {
    await cmd('proposal.reject', { motivo: 'Fuera del alcance de este diseño.' }, x.id);
  }
  informe.cierre = {
    preguntas_descartadas: exploracionFinal.preguntas.length,
    propuestas_rechazadas: restantes.lotes.flatMap((l) => l.propuestas).length,
  };
  informe.readiness = await pedir('GET', `/api/proyectos/${p}/versiones/${fdr?.versionId}/readiness`);
  informe.estado = await pedir('GET', `/api/proyectos/${p}/estado`);
  console.log(JSON.stringify(informe, null, 2));
}

await main();
