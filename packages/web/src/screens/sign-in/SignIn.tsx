// Sign in (spec §4.1): a centred card. A 401 says "Wrong user or password." under the form and
// keeps the user. Afterwards it goes to `next` or to the project.

import { useQueryClient } from '@tanstack/react-query';
import { useRouter, useSearch } from '@tanstack/react-router';
import { type FormEvent, useId, useState } from 'react';
import { ApiError, request, setCsrf } from '../../api/client.ts';
import { keys } from '../../api/queries.ts';
import type { Session } from '../../api/types.ts';
import { Button } from '../../ui/Button.tsx';
import { Reasons } from '../../ui/Reasons.tsx';

/** Only paths inside the app are followed after signing in. */
export function safeNext(next: string | undefined): string {
  if (!next || !next.startsWith('/') || next.startsWith('//') || next.startsWith('/sign-in')) return '/';
  return next;
}

export function SignInScreen() {
  const { next } = useSearch({ strict: false }) as { next?: string };
  const router = useRouter();
  const client = useQueryClient();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [wrong, setWrong] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [pending, setPending] = useState(false);
  const userId = useId();
  const passwordId = useId();

  const submit = async (e: FormEvent) => {
    e.preventDefault();
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
      if (err instanceof ApiError && err.status === 401) setWrong(true);
      else setError(err);
      setPassword('');
    } finally {
      setPending(false);
    }
  };

  const field =
    'dm-text-body h-10 w-full rounded-control border border-line-strong bg-surface px-3 text-ink focus:border-needs focus:outline-none';

  return (
    <main id="main" className="flex min-h-screen items-center justify-center bg-paper px-4">
      <form
        onSubmit={(e) => void submit(e)}
        className="flex w-[380px] flex-col gap-5 rounded-card border border-line bg-surface p-8 shadow-raised"
        aria-labelledby="sign-in-title"
      >
        <div className="flex flex-col gap-1">
          <span className="dm-text-wordmark">DEMIURGO</span>
          <h1 id="sign-in-title" className="dm-text-page-title font-semibold">
            Sign in
          </h1>
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor={userId} className="dm-text-caption font-semibold text-ink-2">
            User
          </label>
          <input
            id={userId}
            name="username"
            autoComplete="username"
            required
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            className={field}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor={passwordId} className="dm-text-caption font-semibold text-ink-2">
            Password
          </label>
          <input
            id={passwordId}
            name="password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={field}
          />
        </div>
        <Button type="submit" variant="secondary" disabled={pending || !username || !password}>
          {pending ? 'Signing in…' : 'Sign in'}
        </Button>
        {wrong && (
          <p role="alert" className="dm-text-small font-medium text-problem">
            Wrong user or password.
          </p>
        )}
        {error ? <Reasons error={error} /> : null}
      </form>
    </main>
  );
}
