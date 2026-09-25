// Preview (DESIGN.md §3.5, D-015): the facts of a thing beside the page without leaving it — its
// readiness, versions, origin — opened by a visible "Preview" button, closed with Esc or Close, the
// focus returning to the button (R51, R59, R91). A side sheet on the right; on small screens it
// covers the page. It replaces the hover "peek".

import { Dialog as D } from 'radix-ui';
import type { ReactNode } from 'react';
import { cn } from '../lib/cn.ts';
import { CloseIcon, EyeIcon } from './icons.tsx';
import { Tooltip } from './Tooltip.tsx';

/** A side sheet with a title, content and a footer (e.g. "Open"). Modal, so focus stays inside. */
export function PreviewSheet({
  open,
  onOpenChange,
  title,
  eyebrow,
  children,
  footer,
  label = 'Preview',
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  eyebrow?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  label?: string;
}) {
  return (
    <D.Root open={open} onOpenChange={onOpenChange}>
      <D.Portal>
        <D.Overlay className="fixed inset-0 z-40 animate-enter bg-scrim sm:bg-transparent" />
        <D.Content
          aria-describedby={undefined}
          data-preview
          className="fixed inset-y-0 right-0 z-50 flex w-full animate-enter flex-col border-l border-edge bg-panel shadow-dialog sm:w-[440px] sm:max-w-[90vw]"
        >
          <div className="flex items-start gap-3 border-b border-edge px-5 pt-4 pb-3">
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <p className="text-xs font-medium text-fg-3">{label}</p>
              {eyebrow ? <div className="flex flex-wrap items-center gap-2 text-sm text-fg-2">{eyebrow}</div> : null}
              <D.Title className="text-lg font-semibold text-fg">{title}</D.Title>
            </div>
            <D.Close
              aria-label="Close the preview"
              className="-mr-2 inline-flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-md text-fg-2 hover:bg-hover hover:text-fg"
            >
              <CloseIcon size={16} />
            </D.Close>
          </div>
          <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-5 py-4">{children}</div>
          {footer ? <div className="flex flex-wrap items-center gap-2 border-t border-edge px-5 py-3">{footer}</div> : null}
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}

/** The small "Preview" button on a card. */
export function PreviewButton({ onClick, label, className }: { onClick: () => void; label: string; className?: string }) {
  return (
    <Tooltip content={label}>
      <button
        type="button"
        aria-label={label}
        onClick={onClick}
        data-preview-button
        className={cn(
          'inline-flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-md text-fg-3 hover:bg-hover hover:text-fg',
          className,
        )}
      >
        <EyeIcon size={15} />
      </button>
    </Tooltip>
  );
}
