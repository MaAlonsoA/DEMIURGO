// Shows untrusted HTML (a component specimen written by an agent) in isolation: an iframe with an
// empty `sandbox` (no scripts, no same-origin, no forms, no navigation), no referrer and a strict
// CSP: only inline styles, data: images and fonts, nothing fetched. CSS animations still run: they
// need no scripts.

import { cn } from '../lib/cn.ts';

const CSP = "default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:";

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
  const doc = `<!doctype html><meta http-equiv="Content-Security-Policy" content="${CSP}">${html}`;
  return (
    <iframe
      title={title}
      srcDoc={doc}
      sandbox=""
      referrerPolicy="no-referrer"
      loading="lazy"
      style={{ height }}
      className={cn('w-full rounded-md border border-edge bg-panel', className)}
    />
  );
}
