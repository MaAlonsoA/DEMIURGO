// The person's own menu (DESIGN.md §2.1): who is signed in, the theme, the dev snapshots (only
// with the dev tools) and Sign out. Project settings live elsewhere (the project switcher and the
// Settings group), so the menu holds only what belongs to the person.

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { request, setCsrf } from '../api/client.ts';
import { sessionQuery } from '../api/queries.ts';
import { ChevronsUpDownIcon, DatabaseIcon, LogOutIcon } from '../components/icons.tsx';
import { Menu, MenuItem, MenuLabel, MenuRadioItems, MenuSeparator } from '../components/Menu.tsx';
import { WhoAvatar } from '../components/Who.tsx';
import { useMessages } from '../i18n/define.ts';
import {
  LOCALE_NAMES,
  type Locale,
  setLocaleChoice,
  setReadingLocaleChoice,
  useLocaleChoice,
  useReadingLocaleChoice,
} from '../i18n/locale.ts';
import { cn } from '../lib/cn.ts';
import { usePerson } from '../lib/hooks.ts';
import { hasDevTools, openDevPanel } from '../screens/dev/snapshots.ts';
import { type ThemeChoice, setTheme, useTheme } from './theme.ts';
import { PERSON_MENU } from './words.i18n.ts';

export function PersonMenu({
  compact,
  className,
  side = 'top',
}: {
  compact?: boolean;
  className?: string;
  /** Where the menu opens: above in the sidebar, below in the top bar. */
  side?: 'top' | 'bottom';
}) {
  const t = useMessages(PERSON_MENU);
  const person = usePerson();
  const devTools = hasDevTools(useQuery(sessionQuery).data);
  const client = useQueryClient();
  const navigate = useNavigate();
  const theme = useTheme();
  const locale = useLocaleChoice();
  const reading = useReadingLocaleChoice();

  // The language is the person's, kept in their session: the same on every device they sign in from.
  const chooseLocale = async (choice: Locale | 'browser') => {
    const next = choice === 'browser' ? null : choice;
    await request('PUT', '/api/session/locale', { locale: next });
    setLocaleChoice(next);
    await client.invalidateQueries({ queryKey: sessionQuery.queryKey });
  };

  const signOut = async () => {
    try {
      await request('DELETE', '/api/session');
    } finally {
      setCsrf(null);
      client.clear();
      await navigate({ to: '/sign-in' });
    }
  };

  return (
    <Menu
      side={side}
      align={side === 'top' ? 'start' : 'end'}
      label={t.yourMenu}
      trigger={
        <button
          type="button"
          aria-label={t.signedInAs(person ?? '')}
          className={cn(
            'flex h-9 w-full min-w-0 cursor-pointer items-center gap-2 rounded-md px-2 text-base text-fg hover:bg-hover',
            className,
          )}
        >
          <WhoAvatar kind="you" size={22} />
          {!compact ? (
            <>
              <span className="min-w-0 flex-1 truncate text-left">{person}</span>
              <ChevronsUpDownIcon size={14} className="shrink-0 text-fg-3" />
            </>
          ) : null}
        </button>
      }
    >
      <MenuLabel>{t.signedInAs(person ?? '')}</MenuLabel>
      <MenuSeparator />
      <MenuLabel>{t.theme}</MenuLabel>
      <MenuRadioItems<ThemeChoice>
        value={theme}
        onChange={setTheme}
        options={[
          { value: 'system', label: t.likeTheSystem },
          { value: 'light', label: t.light },
          { value: 'dark', label: t.dark },
        ]}
      />
      <MenuSeparator />
      <MenuLabel>{t.language}</MenuLabel>
      <MenuRadioItems<Locale | 'browser'>
        value={locale ?? 'browser'}
        onChange={(choice) => void chooseLocale(choice)}
        options={[
          { value: 'browser', label: t.likeTheBrowser },
          { value: 'en', label: LOCALE_NAMES.en },
          { value: 'es', label: LOCALE_NAMES.es },
        ]}
      />
      <MenuLabel>{t.readingLanguage}</MenuLabel>
      <MenuRadioItems<Locale | 'interface'>
        value={reading ?? 'interface'}
        onChange={(choice) => setReadingLocaleChoice(choice === 'interface' ? null : choice)}
        options={[
          { value: 'interface', label: t.likeTheInterface },
          { value: 'en', label: LOCALE_NAMES.en },
          { value: 'es', label: LOCALE_NAMES.es },
        ]}
      />
      <MenuSeparator />
      {devTools ? (
        <MenuItem icon={<DatabaseIcon size={14} />} onSelect={openDevPanel}>
          {t.snapshots}
        </MenuItem>
      ) : null}
      <MenuItem icon={<LogOutIcon size={14} />} onSelect={() => void signOut()}>
        {t.signOut}
      </MenuItem>
    </Menu>
  );
}
