// Playwright helpers: data is prepared with commands through the API (the same path as
// walkthrough-s1), the person signs in through the API or the UI, the external agent uses a token,
// and axe checks each screen.

import { readFile, readdir } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AxeBuilder } from '@axe-core/playwright';
import {
  type APIRequestContext,
  type Browser,
  type BrowserContext,
  type Page,
  expect,
  test as base,
  request as playwrightRequest,
} from '@playwright/test';

export const USER = 'ana';
export const PASSWORD = 'long-test-password';
export const E2E_PORT = Number(process.env.E2E_PORT ?? 8310);
export const BASE_URL = `http://127.0.0.1:${E2E_PORT}`;
const DESIGN_DIR = fileURLToPath(new URL('../../../../../design', import.meta.url));

export type CommandResult<R = Record<string, unknown>> = { entity: string; entity_id: string; state: string; result: R | null };

/** The person, through the API, sharing cookies with the page. */
export class PersonApi {
  readonly request: APIRequestContext;
  csrf = '';
  constructor(request: APIRequestContext) {
    this.request = request;
  }

  async signIn(): Promise<void> {
    const r = await this.request.post('/api/session', { data: { username: USER, password: PASSWORD } });
    expect(r.status()).toBe(200);
    this.csrf = ((await r.json()) as { csrf: string }).csrf;
  }

  async get<T>(path: string): Promise<T> {
    const r = await this.request.get(path);
    if (!r.ok()) throw new Error(`GET ${path}: ${r.status()} ${await r.text()}`);
    return (await r.json()) as T;
  }

  async createProject(name: string): Promise<string> {
    const r = await this.request.post('/api/projects', { data: { name }, headers: { 'x-demiurgo-csrf': this.csrf } });
    if (!r.ok()) throw new Error(`Project: ${r.status()} ${await r.text()}`);
    return ((await r.json()) as { project_id: string }).project_id;
  }

  async command<R = Record<string, unknown>>(
    projectId: string,
    command: string,
    data: Record<string, unknown> = {},
    entityId?: string,
  ): Promise<CommandResult<R>> {
    const r = await this.request.post(`/api/projects/${projectId}/commands/${command}`, {
      data: { ...(entityId ? { entity_id: entityId } : {}), data },
      headers: { 'x-demiurgo-csrf': this.csrf },
    });
    if (!r.ok()) throw new Error(`${command}: ${r.status()} ${await r.text()}`);
    return (await r.json()) as CommandResult<R>;
  }

  /** Imports the repository's design/ as a pending package, like pnpm cli import-design. */
  async importDesign(projectId: string): Promise<{ batchId: string; counts: Record<string, number>; proposals: number }> {
    const tree = await designTree();
    const r = await this.command<{ batchId: string; counts: Record<string, number>; proposals: number }>(
      projectId,
      'design.import',
      {
        tree,
        origin: 'design',
      },
    );
    if (!r.result) throw new Error('The import returned nothing.');
    return r.result;
  }

  /** Issues a token for an external agent and returns its API client. */
  async agent(projectId: string, name = 'claude-code'): Promise<AgentApi> {
    const r = await this.command<{ token: string }>(projectId, 'agent_token.issue', { name });
    const context = await playwrightRequest.newContext({
      baseURL: BASE_URL,
      extraHTTPHeaders: { authorization: `Bearer ${r.result?.token ?? ''}` },
    });
    return new AgentApi(context, projectId);
  }

  /** Waits until a query answers what the test expects (the durable engine works in the background). */
  async until<T>(path: string, done: (v: T) => boolean, timeout = 20_000): Promise<T> {
    const start = Date.now();
    for (;;) {
      const v = await this.get<T>(path);
      if (done(v)) return v;
      if (Date.now() - start > timeout) throw new Error(`Timed out waiting on ${path}: ${JSON.stringify(v).slice(0, 400)}`);
      await new Promise((r) => setTimeout(r, 200));
    }
  }
}

export class AgentApi {
  readonly request: APIRequestContext;
  readonly projectId: string;
  constructor(request: APIRequestContext, projectId: string) {
    this.request = request;
    this.projectId = projectId;
  }
  async command<R = Record<string, unknown>>(command: string, data: Record<string, unknown>): Promise<CommandResult<R>> {
    const r = await this.request.post(`/api/projects/${this.projectId}/commands/${command}`, { data: { data } });
    if (!r.ok()) throw new Error(`${command}: ${r.status()} ${await r.text()}`);
    return (await r.json()) as CommandResult<R>;
  }
}

export async function designTree(): Promise<Record<string, string>> {
  const tree: Record<string, string> = {};
  for (const e of await readdir(DESIGN_DIR, { recursive: true, withFileTypes: true })) {
    if (!e.isFile()) continue;
    const absolute = join(e.parentPath, e.name);
    tree[relative(DESIGN_DIR, absolute).split(sep).join('/')] = await readFile(absolute, 'utf8');
  }
  return Object.fromEntries(Object.entries(tree).sort(([a], [b]) => (a < b ? -1 : 1)));
}

/** No serious or critical accessibility violation on the page (AC-WEB-001-03). */
export async function expectAccessible(page: Page, what: string): Promise<void> {
  const results = await new AxeBuilder({ page }).analyze();
  const serious = results.violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map(
      (v) =>
        `${v.id}: ${v.help} (${v.nodes.map((n) => `${n.target.join(' ')} ${n.html.slice(0, 160)} ${n.failureSummary ?? ''}`).join(' | ')})`,
    );
  expect(serious, `axe on ${what}`).toEqual([]);
}

/** A new browser context without a session, like the configured ones. */
export function anonymousContext(browser: Browser): Promise<BrowserContext> {
  return browser.newContext({
    baseURL: BASE_URL,
    viewport: { width: 1440, height: 900 },
    reducedMotion: 'reduce',
    locale: 'en-GB',
  });
}

/** Signs in through the UI. */
export async function signInThroughUi(page: Page): Promise<void> {
  await page.getByLabel('User').fill(USER);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
}

export const SCREENS_DIR = fileURLToPath(new URL('../../../../../reports/screens', import.meta.url));

/** Screenshot of a screen at 1440 × 900 for the person's review (brief §6). */
export async function screenshot(page: Page, cut: number, name: string): Promise<void> {
  await page.mouse.move(0, 0);
  await page.screenshot({ path: join(SCREENS_DIR, `corte-${cut}`, `${name}.png`), fullPage: false });
}

type Fixtures = { person: PersonApi };

/** Every test gets the person signed in through the API, sharing cookies with its page. */
export const test = base.extend<Fixtures>({
  person: async ({ page }, use) => {
    const p = new PersonApi(page.request);
    await p.signIn();
    await use(p);
  },
});

export { expect };
