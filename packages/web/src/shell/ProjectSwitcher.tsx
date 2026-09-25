// The project switcher (DESIGN.md §2.1): the project's name and a menu to switch to another one,
// see them all, start a new one, or rename this one (project.rename). Rename lives here, with the
// project, not in the person's menu.

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { useCommand } from '../api/commands.ts';
import { projectsQuery } from '../api/queries.ts';
import { CheckIcon, ChevronsUpDownIcon, FolderIcon, PencilIcon, PlusIcon } from '../components/icons.tsx';
import { PromptDialog } from '../components/Dialog.tsx';
import { Menu, MenuItem, MenuLabel, MenuSeparator } from '../components/Menu.tsx';
import { announce } from '../components/announce.tsx';
import { cn } from '../lib/cn.ts';

export function ProjectSwitcher({ projectId, compact }: { projectId: string; compact?: boolean }) {
  const projects = useQuery(projectsQuery).data ?? [];
  const project = projects.find((p) => p.id === projectId);
  const navigate = useNavigate();
  const [renaming, setRenaming] = useState(false);
  const command = useCommand(projectId);
  const client = useQueryClient();

  return (
    <>
      <Menu
        label="Projects"
        trigger={
          <button
            type="button"
            aria-label={`Project: ${project?.name ?? ''}. Switch or manage projects`}
            data-project-switcher
            className={cn(
              'flex h-9 w-full min-w-0 cursor-pointer items-center gap-2 rounded-md px-2 text-left hover:bg-hover',
              compact && 'justify-center px-0',
            )}
          >
            <span
              aria-hidden
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-fg text-xs font-semibold text-panel"
            >
              {(project?.name ?? '·').slice(0, 1).toUpperCase()}
            </span>
            {!compact ? (
              <>
                <span className="min-w-0 flex-1 truncate text-base font-semibold text-fg" title={project?.name}>
                  {project?.name ?? ''}
                </span>
                <ChevronsUpDownIcon size={14} className="shrink-0 text-fg-3" />
              </>
            ) : null}
          </button>
        }
      >
        {projects.length > 1 ? (
          <>
            <MenuLabel>Switch to</MenuLabel>
            {projects.map((p) => (
              <MenuItem
                key={p.id}
                icon={p.id === projectId ? <CheckIcon size={14} /> : <span />}
                onSelect={() => void navigate({ to: '/p/$projectId', params: { projectId: p.id } })}
              >
                {p.name}
              </MenuItem>
            ))}
            <MenuSeparator />
          </>
        ) : null}
        <MenuItem icon={<FolderIcon size={14} />} onSelect={() => void navigate({ to: '/projects' })}>
          All projects
        </MenuItem>
        <MenuItem icon={<PlusIcon size={14} />} onSelect={() => void navigate({ to: '/new' })}>
          New project
        </MenuItem>
        <MenuSeparator />
        <MenuItem
          icon={<PencilIcon size={14} />}
          onSelect={() => {
            command.reset();
            setRenaming(true);
          }}
        >
          Rename the project…
        </MenuItem>
      </Menu>
      <PromptDialog
        open={renaming}
        onOpenChange={setRenaming}
        title="Rename the project"
        label="Name"
        submit="Rename"
        required
        multiline={false}
        initial={project?.name ?? ''}
        maxLength={120}
        pending={command.isPending}
        error={renaming ? command.error : null}
        onSubmit={(name) =>
          command.mutate(
            { command: 'project.rename', entityId: projectId, data: { name } },
            {
              onSuccess: () => {
                void client.invalidateQueries({ queryKey: projectsQuery.queryKey });
                setRenaming(false);
                announce(`The project is now called ${name}.`);
              },
            },
          )
        }
      />
    </>
  );
}
