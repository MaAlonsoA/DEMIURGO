// Real S1 walkthrough against a running server (with whatever agent is configured):
//   node packages/api/src/tools/walkthrough-s1.ts <url> <username> "<intent>" "<message>" ["<message>"…]
// Sends the messages one by one until the agent proposes a decision.
// The person's password is read from stdin. Acts as the person: accepts and
// approves explicitly, just as it would from the UI.

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
  throw new Error(`Run ${id} did not finish.`);
}

async function main(): Promise<void> {
  const password = await readPassword();
  const login = await fetch(`${url}/api/session`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  if (!login.ok) throw new Error(`Login: ${login.status} ${await login.text()}`);
  cookie = (login.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
  csrf = ((await login.json()) as { csrf: string }).csrf;
  const date = new Date().toISOString();
  const report: Record<string, unknown> = { date };

  const { project_id: p } = await request<{ project_id: string }>('POST', '/api/projects', {
    name: `Real S1 walkthrough ${date}`,
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
    report.result = 'The agent did not propose a decision: the walkthrough stops here.';
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
  if (!packageBatch) throw new Error('The design package never arrived.');
  report.fdr_proposed = packageBatch.proposals[0]?.payload;
  const acceptedPackage = await cmd<{ effects: { code: string; versionId: string }[] }>(
    'batch.accept_package',
    {},
    packageBatch.id,
  );
  const fdr = acceptedPackage.result.effects[0];
  await cmd('record_version.approve', {}, fdr?.versionId);
  report.readiness_after_approval = await request('GET', `/api/projects/${p}/versions/${fdr?.versionId}/readiness`);
  // Explicit closing by the person: open questions are resolved by the decision and
  // the remaining proposals are rejected with their reason. None of this is done by an agent.
  const reason = `Resolved by decision ${accepted.result.code}.`;
  const finalExploration = await request<{ questions: { id: string; state: string }[] }>(
    'GET',
    `/api/projects/${p}/explorations/${e.entity_id}`,
  );
  for (const q of finalExploration.questions.filter((x) => ['pending', 'inferred', 'postponed'].includes(x.state))) {
    await cmd('question.discard', { reason }, q.id);
  }
  const remaining = await request<{ batches: { proposals: { id: string }[] }[] }>('GET', `/api/projects/${p}/inbox`);
  for (const x of remaining.batches.flatMap((l) => l.proposals)) {
    await cmd('proposal.reject', { reason: 'Out of scope for this design.' }, x.id);
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
