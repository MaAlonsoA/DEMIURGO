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
import { cn } from '../lib/cn.ts';
import { usePerson } from '../lib/hooks.ts';
import { hasDevTools, openDevPanel } from '../screens/dev/snapshots.ts';
import { type ThemeChoice, setTheme, useTheme } from './theme.ts';

export function PersonMenu({ compact, className }: { compact?: boolean; className?: string }) {
  const person = usePerson();
  const devTools = hasDevTools(useQuery(sessionQuery).data);
  const client = useQueryClient();
  const navigate = useNavigate();
  const theme = useTheme();

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
      side="top"
      align="start"
      label="Your menu"
      trigger={
        <button
          type="button"
          aria-label={`Signed in as ${person ?? ''}`}
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
      <MenuLabel>Signed in as {person}</MenuLabel>
      <MenuSeparator />
      <MenuLabel>Theme</MenuLabel>
      <MenuRadioItems<ThemeChoice>
        value={theme}
        onChange={setTheme}
        options={[
          { value: 'system', label: 'Like the system' },
          { value: 'light', label: 'Light' },
          { value: 'dark', label: 'Dark' },
        ]}
      />
      <MenuSeparator />
      {devTools ? (
        <MenuItem icon={<DatabaseIcon size={14} />} onSelect={openDevPanel}>
          Snapshots…
        </MenuItem>
      ) : null}
      <MenuItem icon={<LogOutIcon size={14} />} onSelect={() => void signOut()}>
        Sign out
      </MenuItem>
    </Menu>
  );
}
