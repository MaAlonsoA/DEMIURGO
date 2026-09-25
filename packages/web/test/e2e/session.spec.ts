import {
  BASE_URL,
  PASSWORD,
  USER,
  anonymousContext,
  expect,
  expectAccessible,
  screenshot,
  signInThroughUi,
  test,
} from './support/fixtures.ts';

test('AC-INT-001-02 an internal route without a session goes to Sign in, comes back after signing in, and Sign out ends the session', async ({
  browser,
  person,
}) => {
  const projectId = await person.createProject('Session walk');
  const context = await anonymousContext(browser);
  const page = await context.newPage();

  await page.goto(`/p/${projectId}/threads`);
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  await expect(page).toHaveURL(/\/sign-in\?next=/);
  await expectAccessible(page, 'Sign in');

  // A missing field is explained in words, next to it, and the focus goes there.
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByText('Write your user to sign in.')).toBeVisible();
  await expect(page.getByText('Write your password to sign in.')).toBeVisible();
  await expect(page.getByLabel('User')).toBeFocused();

  // A wrong password says so and keeps the user.
  await page.getByLabel('User').fill(USER);
  await page.getByLabel('Password').fill('not-the-password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByText('Wrong user or password.')).toBeVisible();
  await expect(page.getByLabel('User')).toHaveValue(USER);
  await expect(page.getByLabel('Password')).toHaveValue('');

  await signInThroughUi(page);
  await expect(page).toHaveURL(`${BASE_URL}/p/${projectId}/threads`);
  await expect(page.getByRole('navigation', { name: 'Sections' })).toBeVisible();

  await page.getByRole('button', { name: `Signed in as ${USER}` }).click();
  await page.getByRole('menuitem', { name: 'Sign out' }).click();
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  const after = await page.request.get(`/api/projects/${projectId}/state`);
  expect(after.status()).toBe(401);
  await context.close();
});

test('AC-INT-001-02 Sign out is at hand outside a project too: on Your projects and on New project', async ({ page, person }) => {
  await person.createProject('Outside one');
  await person.createProject('Outside two');
  await page.goto('/projects');
  await expect(page.getByRole('heading', { level: 1, name: 'Your projects' })).toBeVisible();
  await page.getByRole('main').getByRole('link', { name: 'New project' }).click();
  await expect(page).toHaveURL(/\/new$/);
  await page.getByRole('button', { name: `Signed in as ${USER}` }).click();
  await page.getByRole('menuitem', { name: 'Sign out' }).click();
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  expect((await page.request.get('/api/projects')).status()).toBe(401);
});

test('AC-INT-001-02 a reloaded page keeps the session and can still write', async ({ page, person }) => {
  const projectId = await person.createProject('Reload');
  await page.goto(`/p/${projectId}`);
  await page.reload();
  await expect(page.getByRole('navigation', { name: 'Sections' })).toBeVisible();
  const session = (await (await page.request.get('/api/session')).json()) as { csrf: string };
  const write = await page.request.post(`/api/projects/${projectId}/commands/exploration.open`, {
    data: { data: { purpose: 'After a reload' } },
    headers: { 'x-demiurgo-csrf': session.csrf },
  });
  expect(write.status()).toBe(200);
});

test('AC-WEB-001-03 signing in and moving between the tabs works with the keyboard only', async ({ browser, person }) => {
  const projectId = await person.createProject('Keyboard');
  const context = await anonymousContext(browser);
  const page = await context.newPage();
  await page.goto(`/p/${projectId}`);
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  // The focus starts on "User": nothing to Tab past.
  const user = page.getByLabel('User');
  await expect(user).toBeFocused();
  await page.keyboard.type(USER);
  await page.keyboard.press('Tab');
  await page.keyboard.type(PASSWORD);
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(`${BASE_URL}/p/${projectId}`);

  // Reach the "Threads" section with Tab alone and open it with Enter.
  const threads = page.getByRole('navigation', { name: 'Sections' }).getByRole('link', { name: 'Threads' });
  for (let i = 0; i < 20 && !(await threads.evaluate((el) => el === document.activeElement)); i++) {
    await page.keyboard.press('Tab');
  }
  await expect(threads).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(`${BASE_URL}/p/${projectId}/threads`);
  await expectAccessible(page, 'the project shell');
  await context.close();
});

test('screens of cut 0: sign in, the project shell, and not found — never linking back to a project that is not there', async ({
  browser,
  page,
  person,
}) => {
  const projectId = await person.createProject('Cut 0');
  const anonymous = await anonymousContext(browser);
  const signIn = await anonymous.newPage();
  await signIn.goto('/sign-in');
  await expect(signIn.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  await screenshot(signIn, 0, '01-sign-in');
  await anonymous.close();

  await page.goto(`/p/${projectId}/threads`);
  await expect(page.getByRole('navigation', { name: 'Sections' })).toBeVisible();
  await screenshot(page, 0, '02-header-and-shell');

  // An unknown page of a known project leads back to its product.
  await page.goto(`/p/${projectId}/does-not-exist`);
  await expect(page.getByRole('heading', { level: 1, name: /We couldn.t find this page/ })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Back to the product' })).toHaveAttribute('href', `/p/${projectId}`);
  await expectAccessible(page, 'Not found');
  await screenshot(page, 0, '03-not-found');

  // An unknown project never links back to itself: the way back is DEMIURGO.
  await page.goto('/p/00000000-0000-4000-8000-000000000000/threads');
  await expect(page.getByRole('heading', { level: 1, name: /We couldn.t find this page/ })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Back to DEMIURGO' })).toHaveAttribute('href', '/');
  await expect(page.getByRole('main')).toHaveCount(1);
  await expectAccessible(page, 'Not found, an unknown project');
});

test('AC-INT-001-02 Sign in with a session already open goes straight on, and never to an outside address', async ({
  page,
  person,
}) => {
  await person.createProject('Already in');
  await page.goto('/sign-in?next=%2Fprojects');
  await expect(page).toHaveURL(/\/projects$/);
  await expect(page.getByRole('heading', { name: 'Sign in' })).toHaveCount(0);
  await page.goto('/sign-in?next=%2F%2Fexample.com');
  await expect(page).not.toHaveURL(/example\.com/);
  await expect(page.getByRole('heading', { name: 'Sign in' })).toHaveCount(0);
});
