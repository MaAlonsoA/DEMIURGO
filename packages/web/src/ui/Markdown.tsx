// Sections of a record, shown as they were written (markdown, never raw HTML).

import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { cn } from '../lib/cn.ts';

export function Markdown({ children, className }: { children: string; className?: string }) {
  return (
    <div className={cn('prose-record', className)}>
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{children}</ReactMarkdown>
    </div>
  );
}
