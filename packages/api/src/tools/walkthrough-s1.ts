// Recorrido real de S1 contra un servidor en marcha (con el agente que tenga configurado):
//   node packages/api/src/herramientas/recorrido-s1.ts <url> <usuario> "<intención>" "<mensaje>" ["<mensaje>"…]
// Envía los mensajes de uno en uno hasta que el agente propone una decisión.
// La clave de la persona se lee de la entrada estándar. Actúa como la persona: acepta y
// aprueba explícitamente, igual que haría desde la UI.

const [url = 'http://127.0.0.1:8100', username = '', intent = '', ...messages] = process.argv.slice(2);

async function readPassword(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const t of process.stdin) chunks.push(t as Buffer);
  return Buffer.concat(chunks).toString('utf8').trim();
}

let cookie = '';
let csrf = '';

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const r = await fetch(`${url}${path}`, {
    method: method,
    headers: { 'content-type': 'application/json', cookie, 'x-demiurgo-csrf': csrf },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`${method} ${path}: ${r.status} ${text}`);
  return JSON.parse(text) as T;
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
type Run = {
  id: string;
  state: string;
  action: string;
  model: string | null;
  usage: unknown;
  failure_kind: string | null;
  error: string | null;
};

async function waitForRun(projectId: string, id: string): Promise<Run> {
  for (let i = 0; i < 300; i++) {
    const r = await request<Run>('GET', `/api/projects/${projectId}/runs/${id}`);
    if (!['queued', 'running'].includes(r.state)) return r;
    await wait(1000);
  }
  throw new Error(`La ejecución ${id} no terminó.`);
}

async function main(): Promise<void> {
  const key = await readPassword();
  const login = await fetch(`${url}/api/session`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, key }),
  });
  if (!login.ok) throw new Error(`Inicio de sesión: ${login.status} ${await login.text()}`);
  cookie = (login.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
  csrf = ((await login.json()) as { csrf: string }).csrf;
  const date = new Date().toISOString();
  const report: Record<string, unknown> = { date };

  const { project_id: p } = await request<{ project_id: string }>('POST', '/api/projects', {
    name: `Recorrido real S1 ${date}`,
  });
  type Response<T> = { entity_id: string; result: T };
  const cmd = <T = unknown>(name: string, data: unknown, entity?: string): Promise<Response<T>> =>
    request<Response<T>>('POST', `/api/projects/${p}/commands/${name}`, {
      ...(entity ? { entity_id: entity } : {}),
      data,
    });

  const e = await cmd('exploration.open', { purpose: intent });
  type Proposal = { id: string; type: string; payload: unknown };
  const turns: unknown[] = [];
  let decision: Proposal | undefined;
  for (const message of messages) {
    const before = (await request<{ command: string }[]>('GET', `/api/projects/${p}/events`)).filter(
      (ev) => ev.command === 'run.request',
    ).length;
    await cmd('message.post', { exploration_id: e.entity_id, text: message });
    let chat: Run | undefined;
    for (let i = 0; i < 180 && !chat; i++) {
      await wait(1000);
      const requests = (await request<{ entity_id: string; command: string }[]>('GET', `/api/projects/${p}/events`)).filter(
        (ev) => ev.command === 'run.request',
      );
      const fresh = requests[before];
      if (fresh) chat = await waitForRun(p, fresh.entity_id);
    }
    const exploration = await request<{
      messages: { author: string; body: string; kind: string | null; run_id: string | null }[];
      questions: { question: string; state: string }[];
    }>('GET', `/api/projects/${p}/explorations/${e.entity_id}`);
    const inbox = await request<{ batches: { proposals: Proposal[] }[] }>('GET', `/api/projects/${p}/inbox`);
    const proposals = inbox.batches.flatMap((l) => l.proposals);
    turns.push({
      message,
      run: chat && {
        id: chat.id,
        state: chat.state,
        model: chat.model,
        usage: chat.usage,
        failure: chat.failure_kind,
        error: chat.error,
      },
      response: exploration.messages.filter((m) => m.run_id === chat?.id).map((m) => ({ type: m.kind, text: m.body })),
      questions: exploration.questions.map((q) => `${q.state}: ${q.question}`),
      proposals: proposals.map((x) => ({ type: x.type, payload: x.payload })),
    });
    decision = proposals.find((x) => x.type === 'decision');
    if (decision) break;
  }
  report.turns = turns;
  if (!decision) {
    report.result = 'El agente no propuso ninguna decisión: el recorrido se detiene aquí.';
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  const accepted = await cmd<{ code: string; versionId: string }>('proposal.accept', { approve: true }, decision.id);
  const design = await cmd<{ runId: string }>('run.request', {
    action: 'design_proposal',
    scope: { type: 'record_version', id: accepted.result.versionId },
  });
  report.design_proposal = await waitForRun(p, design.entity_id);
  const b2 = await request<{ batches: { id: string; type: string; proposals: { payload: unknown }[] }[] }>(
    'GET',
    `/api/projects/${p}/inbox`,
  );
  const packageBatch = b2.batches.find((l) => l.type === 'system_package');
  if (!packageBatch) throw new Error('No llegó el paquete de diseño.');
  report.fdr_proposed = packageBatch.proposals[0]?.payload;
  const acceptedPackage = await cmd<{ effects: { code: string; versionId: string }[] }>('batch.accept_package', {}, packageBatch.id);
  const fdr = acceptedPackage.result.effects[0];
  await cmd('record_version.approve', {}, fdr?.versionId);
  report.readiness_after_approval = await request('GET', `/api/projects/${p}/versions/${fdr?.versionId}/readiness`);
  // Cierre explícito de la persona: las preguntas abiertas quedan resueltas por la decisión y
  // las propuestas sobrantes se rechazan con su motivo. Nada de esto lo hace un agente.
  const reason = `Resuelta por la decisión ${accepted.result.code}.`;
  const finalExploration = await request<{ questions: { id: string; state: string }[] }>(
    'GET',
    `/api/projects/${p}/explorations/${e.entity_id}`,
  );
  for (const q of finalExploration.questions.filter((x) => ['pending', 'inferred', 'postponed'].includes(x.state))) {
    await cmd('question.discard', { reason }, q.id);
  }
  const remaining = await request<{ batches: { proposals: { id: string }[] }[] }>('GET', `/api/projects/${p}/inbox`);
  for (const x of remaining.batches.flatMap((l) => l.proposals)) {
    await cmd('proposal.reject', { reason: 'Fuera del alcance de este diseño.' }, x.id);
  }
  report.closing = {
    discarded_questions: finalExploration.questions.length,
    rejected_proposals: remaining.batches.flatMap((l) => l.proposals).length,
  };
  report.readiness = await request('GET', `/api/projects/${p}/versions/${fdr?.versionId}/readiness`);
  report.state = await request('GET', `/api/projects/${p}/state`);
  console.log(JSON.stringify(report, null, 2));
}

await main();
