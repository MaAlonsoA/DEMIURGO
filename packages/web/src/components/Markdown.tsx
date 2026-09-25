// Markdown as it was written (records, DEMIURGO's replies): GitHub-flavoured, never raw HTML, in
// the prose style (base.css .md-prose). Links open in place when they are internal.

import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { cn } from '../lib/cn.ts';

export function Markdown({ children, className, size = 'md' }: { children: string; className?: string; size?: 'sm' | 'md' }) {
  return (
    <div className={cn('md-prose', size === 'sm' && 'md-prose--sm', className)}>
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{children}</ReactMarkdown>
    </div>
  );
}
