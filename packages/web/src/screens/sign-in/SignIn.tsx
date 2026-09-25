// Sign in (DESIGN.md §3.9, §6.7): outside the app shell, a centred card with DEMIURGO's wordmark.
// The focus starts on "User"; a missing field is explained in words next to it instead of a
// silently disabled button; paste and password managers work (WCAG 3.3.8, R82). A 401 says
// "Wrong user or password." and keeps the user; any other failure is explained in product words.
// Afterwards it goes to `next` (only paths inside the app) or to "/".

import { useQueryClient } from '@tanstack/react-query';
import { useRouter, useSearch } from '@tanstack/react-router';
import { type FormEvent, useRef, useState } from 'react';
import { ApiError, request, setCsrf } from '../../api/client.ts';
import { keys } from '../../api/queries.ts';
import type { Session } from '../../api/types.ts';
import { Button } from '../../components/Button.tsx';
import { Field, TextInput } from '../../components/Field.tsx';
import { ErrorNotice, Notice } from '../../components/Notice.tsx';
import { usePageTitle } from '../../components/Page.tsx';
import { Wordmark } from '../../shell/WorkspaceFrame.tsx';

/** Only paths inside the app are followed after signing in. */
export function safeNext(next: string | undefined): string {
  if (!next || !next.startsWith('/') || next.startsWith('//') || next.startsWith('/sign-in')) return '/';
  return next;
}

type Missing = { user: boolean; password: boolean };

export function SignInScreen() {
  usePageTitle(['Sign in']);
  const { next } = useSearch({ strict: false }) as { next?: string };
  const router = useRouter();
  const client = useQueryClient();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [missing, setMissing] = useState<Missing>({ user: false, password: false });
  const [wrong, setWrong] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [pending, setPending] = useState(false);
  const userRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (pending) return;
    const gaps = { user: !username.trim(), password: !password };
    setMissing(gaps);
    if (gaps.user || gaps.password) {
      (gaps.user ? userRef : passwordRef).current?.focus();
      return;
    }
    setPending(true);
    setWrong(false);
    setError(null);
    try {
      const r = await request<{ person: string; csrf: string }>('POST', '/api/session', { username, password });
      setCsrf(r.csrf);
      const session: Session = { actor: { type: 'human', person: r.person }, type: 'person', csrf: r.csrf };
      client.setQueryData(keys.session, session);
      // The server's own view of the session may say more (the dev tools): fetched in the background.
      void client.invalidateQueries({ queryKey: keys.session });
      await client.invalidateQueries({ queryKey: keys.projects });
      router.history.push(safeNext(next));
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setWrong(true);
        passwordRef.current?.focus();
      } else setError(err);
      setPassword('');
      setPending(false);
    }
  };

  return (
    <main id="main" className="flex min-h-screen flex-col items-center justify-center bg-app px-4 py-12 font-ui text-fg">
      <div className="flex w-full max-w-sm flex-col items-stretch gap-6">
        <Wordmark className="self-center" />
        <form
          noValidate
          onSubmit={(e) => void submit(e)}
          aria-labelledby="page-title"
          className="flex flex-col gap-5 rounded-xl border border-edge bg-panel px-6 py-7 sm:px-8"
        >
          <h1 id="page-title" tabIndex={-1} className="text-xl font-semibold text-fg outline-none">
            Sign in
          </h1>
          <Field label="User" error={missing.user ? 'Write your user to sign in.' : undefined}>
            {(p) => (
              <TextInput
                {...p}
                ref={userRef}
                name="username"
                autoComplete="username"
                autoCapitalize="none"
                spellCheck={false}
                required
                // biome-ignore lint/a11y/noAutofocus: the only thing to do on this page is to write the user (DESIGN.md §3.9)
                autoFocus
                value={username}
                onChange={(e) => {
                  setUsername(e.target.value);
                  if (missing.user) setMissing((m) => ({ ...m, user: false }));
                }}
                className="h-10"
              />
            )}
          </Field>
          <Field label="Password" error={missing.password ? 'Write your password to sign in.' : undefined}>
            {(p) => (
              <TextInput
                {...p}
                ref={passwordRef}
                name="password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  if (missing.password) setMissing((m) => ({ ...m, password: false }));
                }}
                className="h-10"
              />
            )}
          </Field>
          {wrong ? <Notice tone="danger" role="alert" title="Wrong user or password." /> : null}
          {error ? <ErrorNotice error={error} /> : null}
          <Button type="submit" variant="primary" size="lg" pending={pending} pendingLabel="Signing in…" className="w-full">
            Sign in
          </Button>
        </form>
      </div>
    </main>
  );
}
