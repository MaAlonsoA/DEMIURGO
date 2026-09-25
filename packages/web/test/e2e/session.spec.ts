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

  // A wrong password says so and keeps the user.
  await page.getByLabel('User').fill(USER);
  await page.getByLabel('Password').fill('not-the-password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByText('Wrong user or password.')).toBeVisible();
  await expect(page.getByLabel('User')).toHaveValue(USER);

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
  // The first stop is "Skip to content"; then the form.
  const user = page.getByLabel('User');
  for (let i = 0; i < 5 && !(await user.evaluate((el) => el === document.activeElement)); i++) await page.keyboard.press('Tab');
  await expect(user).toBeFocused();
  await page.keyboard.type(USER);
  await page.keyboard.press('Tab');
  await page.keyboard.type(PASSWORD);
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(`${BASE_URL}/p/${projectId}`);

  // Reach the "Threads" tab with Tab alone and open it with Enter.
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

test('screens of cut 0: sign in, the header with the legend, and not found', async ({ browser, page, person }) => {
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
  await page.goto(`/p/${projectId}/does-not-exist`);
  await expect(page.getByRole('heading', { name: /We couldn.t find/ })).toBeVisible();
  await expectAccessible(page, 'Not found');
  await screenshot(page, 0, '03-not-found');
});
