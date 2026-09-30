// Shows untrusted HTML (a component specimen, a style tile, a screen written by an agent) in
// isolation: an iframe with an empty `sandbox` (no scripts, no same-origin, no forms, no
// navigation), no referrer and a strict CSP: only inline styles, data: images and fonts, nothing
// fetched. CSS animations still run: they need no scripts.
//
// A preview is judged by looking at it the way it will be used, so each one has a toolbar: light or
// dark (when the HTML draws a dark theme), phone width (360 CSS px: the width WCAG 2.2 1.4.10 Reflow
// asks to hold from 320) or desktop, and full screen.

import { Dialog as D } from 'radix-ui';
import { useId, useMemo, useState } from 'react';
import { useMessages } from '../i18n/define.ts';
import { cn } from '../lib/cn.ts';
import { applyPreviewTheme, supportsDark, type PreviewTheme } from '../lib/preview-theme.ts';
import { Button } from './Button.tsx';
import { CloseIcon } from './icons.tsx';
import { PREVIEW_VIEWER } from './words.i18n.ts';

const CSP = "default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:";
const PHONE_WIDTH = 360;

type Width = 'phone' | 'desktop';
type ViewState = { theme: PreviewTheme; width: Width };

function Frame({
  html,
  title,
  theme,
  width,
  height,
  className,
}: {
  html: string;
  title: string;
  theme: PreviewTheme;
  width: Width;
  height?: number;
  className?: string;
}) {
  const doc = useMemo(
    () => `<!doctype html><meta http-equiv="Content-Security-Policy" content="${CSP}">${applyPreviewTheme(html, theme)}`,
    [html, theme],
  );
  const phone = width === 'phone';
  return (
    <div className={cn('flex min-h-0 w-full justify-center', phone && 'rounded-md bg-sunken p-3', className)}>
      <iframe
        title={title}
        srcDoc={doc}
        sandbox=""
        referrerPolicy="no-referrer"
        loading="lazy"
        data-preview-width={width}
        data-preview-theme={theme}
        style={{ height, width: phone ? PHONE_WIDTH : '100%', maxWidth: '100%' }}
        className={cn('border border-edge bg-panel', phone ? 'rounded-xl' : 'rounded-md', !height && 'h-full')}
      />
    </div>
  );
}

function Toolbar({
  state,
  onChange,
  canDark,
  onFullScreen,
}: {
  state: ViewState;
  onChange: (next: ViewState) => void;
  canDark: boolean;
  onFullScreen?: () => void;
}) {
  const t = useMessages(PREVIEW_VIEWER);
  const tab = (active: boolean, disabled = false) =>
    cn(
      'inline-flex h-7 min-w-6 cursor-pointer items-center rounded-md px-2.5 text-sm',
      active ? 'bg-sunken font-medium text-fg' : 'text-fg-2 hover:text-fg',
      disabled && 'cursor-not-allowed opacity-50 hover:text-fg-2',
    );
  return (
    <div role="toolbar" aria-label={t.toolbar} className="flex flex-wrap items-center gap-x-4 gap-y-1">
      <div role="group" aria-label={t.theme} className="flex items-center gap-0.5">
        <button type="button" aria-pressed={state.theme === 'light'} data-preview-theme-toggle="light" className={tab(state.theme === 'light')} onClick={() => onChange({ ...state, theme: 'light' })}>
          {t.light}
        </button>
        <button
          type="button"
          aria-pressed={state.theme === 'dark'}
          data-preview-theme-toggle="dark"
          disabled={!canDark}
          title={canDark ? undefined : t.noDark}
          className={tab(state.theme === 'dark', !canDark)}
          onClick={() => onChange({ ...state, theme: 'dark' })}
        >
          {canDark ? t.dark : t.noDark}
        </button>
      </div>
      <div role="group" aria-label={t.width} className="flex items-center gap-0.5">
        <button type="button" aria-pressed={state.width === 'phone'} data-preview-width-toggle="phone" className={tab(state.width === 'phone')} onClick={() => onChange({ ...state, width: 'phone' })}>
          {t.phone}
        </button>
        <button type="button" aria-pressed={state.width === 'desktop'} data-preview-width-toggle="desktop" className={tab(state.width === 'desktop')} onClick={() => onChange({ ...state, width: 'desktop' })}>
          {t.desktop}
        </button>
      </div>
      {onFullScreen ? (
        <Button size="sm" variant="quiet" data-preview-fullscreen onClick={onFullScreen}>
          {t.fullScreen}
        </Button>
      ) : null}
    </div>
  );
}

/** The full-viewport viewer: same toggles, Esc closes. Controlled, so a card can open it from elsewhere. */
export function PreviewDialog({
  open,
  onOpenChange,
  html,
  title,
  initial,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  html: string;
  title: string;
  initial?: Partial<ViewState>;
}) {
  const t = useMessages(PREVIEW_VIEWER);
  const canDark = supportsDark(html);
  const [state, setState] = useState<ViewState>({ theme: 'light', width: 'phone', ...initial });
  const theme = canDark ? state.theme : 'light';
  return (
    <D.Root open={open} onOpenChange={onOpenChange}>
      <D.Portal>
        <D.Overlay className="fixed inset-0 z-50 bg-scrim animate-enter" />
        <D.Content
          aria-describedby={undefined}
          data-preview-dialog
          className="fixed inset-0 z-50 flex flex-col gap-3 bg-app p-4 animate-enter"
        >
          <div className="flex items-start gap-3">
            <D.Title className="min-w-0 flex-1 text-lg font-semibold text-fg">{title}</D.Title>
            <D.Close
              aria-label={t.close}
              className="inline-flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-md text-fg-2 hover:bg-hover hover:text-fg"
            >
              <CloseIcon size={16} />
            </D.Close>
          </div>
          <Toolbar state={{ ...state, theme }} onChange={setState} canDark={canDark} />
          <Frame html={html} title={title} theme={theme} width={state.width} className="flex-1 overflow-auto" />
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}

export function SandboxedPreview({
  html,
  title,
  height = 240,
  className,
}: {
  html: string;
  title: string;
  height?: number;
  className?: string;
}) {
  const id = useId();
  const canDark = supportsDark(html);
  const [state, setState] = useState<ViewState>({ theme: 'light', width: 'desktop' });
  const [full, setFull] = useState(false);
  return (
    <div data-preview={id} className={cn('flex flex-col gap-1.5', className)}>
      <Toolbar state={state} onChange={setState} canDark={canDark} onFullScreen={() => setFull(true)} />
      <Frame html={html} title={title} theme={canDark ? state.theme : 'light'} width={state.width} height={height} />
      {full ? <PreviewDialog open onOpenChange={setFull} html={html} title={title} initial={state} /> : null}
    </div>
  );
}
