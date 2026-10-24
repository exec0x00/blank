import { Children, isValidElement, memo, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Check, Copy, ExternalLink, FileCode2 } from 'lucide-react';
import type { WebCitation } from '../../../shared/types';
import { MessageCitations } from './MessageCitations';
import { hideCitationMarkers } from './citations';
import { copyText, errorMessage } from './state';

type Notify = (message: string, kind?: 'error' | 'success' | 'info') => void;

function textContent(children: ReactNode): string {
  return Children.toArray(children).map(child => typeof child === 'string' || typeof child === 'number' ? String(child) : isValidElement<{ children?: ReactNode }>(child) ? textContent(child.props.children) : '').join('');
}

export function CopyButton({ text, label = 'Copy', onNotify }: { text: string; label?: string; onNotify: Notify }) {
  const [copiedValue, setCopiedValue] = useState<string | null>(null);
  const copied = copiedValue === text;
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  async function copy() {
    try {
      await copyText(text);
      // A growing streamed code block must not label its new bytes as copied.
      setCopiedValue(text);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopiedValue(null), 1800);
    } catch (error) { onNotify(errorMessage(error), 'error'); }
  }

  return <button type="button" className={`chat-copy ${copied ? 'is-copied' : ''}`} title={copied ? 'Copied' : label} aria-label={copied ? 'Copied to clipboard' : label} onClick={() => void copy()}>
    {copied ? <Check size={13} /> : <Copy size={13} />}<span>{copied ? 'Copied' : label}</span>
  </button>;
}

function CodeBlock({ children, onNotify }: { children?: ReactNode; onNotify: Notify }) {
  const child = Children.toArray(children).find(item => isValidElement(item));
  const className = isValidElement<{ className?: string }>(child) ? child.props.className ?? '' : '';
  const language = /language-([\w+-]+)/.exec(className)?.[1] ?? 'code';
  const content = textContent(children).replace(/\n$/, '');
  return <div className="chat-code-block">
    <div className="chat-code-heading"><span>{language}</span><CopyButton text={content} onNotify={onNotify} /></div>
    <pre tabIndex={0} aria-label={`${language} code`}>{children}</pre>
  </div>;
}

function localFile(href: string | undefined, workspacePath: string): string | null {
  if (!href || href.startsWith('#') || href.startsWith('//') || /^[a-z][a-z\d+.-]*:/i.test(href)) return null;
  let path: string;
  try { path = decodeURIComponent(href); } catch { return null; }
  path = path.replace(/#L\d+(?:-L?\d+)?$/, '').replace(/:\d+(?::\d+)?$/, '');
  if (path.startsWith(workspacePath + '/')) path = path.slice(workspacePath.length + 1);
  path = path.replace(/^\.\//, '').replace(/^\//, '');
  if (!path || path.split('/').some(part => part === '..') || path.includes('\0')) return null;
  return path;
}

export const MarkdownMessage = memo(function MarkdownMessage({ content, citations, workspacePath, onOpenFile, onNotify }: {
  content: string;
  citations?: readonly WebCitation[];
  workspacePath: string;
  onOpenFile?: (path: string) => void;
  onNotify: Notify;
}) {
  // The renderers are component types. Recreating them for every delta would
  // remount code blocks/links, dropping keyboard focus, selection and scroll.
  const components = useMemo<Components>(() => ({
    pre: ({ children }) => <CodeBlock onNotify={onNotify}>{children}</CodeBlock>,
    a: ({ href, children }) => {
      const path = localFile(href, workspacePath);
      if (path && onOpenFile) return <button type="button" className="chat-inline-file" title={`Open ${path}`} onClick={() => onOpenFile(path)}><FileCode2 size={12} />{children}</button>;
      return <a href={href} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">{children}<ExternalLink size={11} aria-hidden="true" /></a>;
    },
    // Do not make third-party image requests from model output. Links keep them opt-in.
    img: ({ src, alt }) => src ? <a href={src} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">{alt || 'Open image'}<ExternalLink size={11} aria-hidden="true" /></a> : <span>{alt}</span>,
    table: ({ children }) => <div className="chat-table-scroll" tabIndex={0}><table>{children}</table></div>,
  }), [workspacePath, onNotify, onOpenFile]);
  return <><div className="chat-markdown">
    <ReactMarkdown remarkPlugins={[remarkGfm, hideCitationMarkers]} skipHtml components={components}>{content}</ReactMarkdown>
  </div><MessageCitations citations={citations} /></>;
});
