import type { CSSProperties } from 'react';
import Logo from '../Logo';
import './loading.css';

/** Decorative placeholders never stand in for an answer, file name, or progress. */
export function Skeleton({ width, height, className = '' }: { width?: CSSProperties['width']; height?: CSSProperties['height']; className?: string }) {
  return <span className={`arc-skeleton ${className}`} style={{ width, height }} aria-hidden="true" />;
}

export function LoadingStatus({ label, description }: { label: string; description?: string }) {
  return <div className="arc-loading-status" role="status" aria-live="polite">
    <span className="arc-loading-dot" aria-hidden="true" />
    <span>{label}{description && <small>{description}</small>}</span>
  </div>;
}

function ConversationPlaceholder() {
  return <div className="arc-skeleton-content arc-conversation-placeholder" aria-hidden="true">
    <div className="arc-skeleton-message is-outgoing"><Skeleton width="88%" /><Skeleton width="58%" /></div>
    <div className="arc-skeleton-message"><Skeleton width="70%" /><Skeleton width="94%" /><Skeleton width="84%" /><Skeleton width="46%" /></div>
    <div className="arc-skeleton-message arc-skeleton-message-secondary"><Skeleton width="79%" /><Skeleton width="92%" /><Skeleton width="56%" /></div>
  </div>;
}

function EditorPlaceholder() {
  return <div className="arc-skeleton-content arc-editor-placeholder" aria-hidden="true">
    {[62, 78, 46, 68, 82, 53, 72, 40, 66, 48].map((width, index) => <div className="arc-skeleton-code-row" key={index}>
      <Skeleton width={9} className="arc-skeleton-gutter" />
      <Skeleton width={`${width}%`} className={index > 1 && index < 6 ? 'is-indented' : ''} />
    </div>)}
  </div>;
}

export function ConversationSkeleton({ label = 'Opening your conversation…', chrome = false }: { label?: string; chrome?: boolean }) {
  return <div className={`arc-loading arc-conversation-skeleton${chrome ? ' has-chrome' : ''}`} data-loading="conversation" aria-busy="true">
    {chrome && <div className="arc-skeleton-panel-header" aria-hidden="true"><Skeleton width="52%" height={13} /><Skeleton width={26} height={26} /></div>}
    <LoadingStatus label={label} />
    <ConversationPlaceholder />
    {chrome && <div className="arc-skeleton-composer" aria-hidden="true"><Skeleton width="58%" /><Skeleton width={24} height={24} /></div>}
  </div>;
}

export function EditorSkeleton({ label = 'Opening editor…', comparison = false }: { label?: string; comparison?: boolean }) {
  return <div className="arc-loading arc-editor-skeleton" data-loading="editor" aria-busy="true">
    <LoadingStatus label={label} />
    <div className={`arc-skeleton-editor-columns${comparison ? ' is-comparison' : ''}`}><EditorPlaceholder />{comparison && <EditorPlaceholder />}</div>
  </div>;
}

export function ListSkeleton({ label, rows = 5, compact = false }: { label: string; rows?: number; compact?: boolean }) {
  return <div className={`arc-loading arc-list-skeleton${compact ? ' is-compact' : ''}`} data-loading="list" aria-busy="true">
    <LoadingStatus label={label} />
    <div className="arc-skeleton-content" aria-hidden="true">{Array.from({ length: Math.min(8, Math.max(1, rows)) }, (_, index) => <div className="arc-skeleton-list-row" key={index}>
      {compact && <Skeleton width={14} height={14} />}
      <div><Skeleton width={`${[66, 82, 57, 74, 61][index % 5]}%`} />{!compact && <Skeleton width={`${[34, 46, 39][index % 3]}%`} height={9} />}</div>
    </div>)}</div>
  </div>;
}

export function PanelSkeleton({ label, kind = 'list' }: { label: string; kind?: 'conversation' | 'editor' | 'terminal' | 'list' }) {
  if (kind === 'conversation') return <ConversationSkeleton label={label} chrome />;
  if (kind === 'editor') return <div className="arc-loading-panel"><div className="arc-skeleton-panel-header" aria-hidden="true"><Skeleton width={120} /><Skeleton width={26} height={26} /></div><EditorSkeleton label={label} /></div>;
  if (kind === 'terminal') return <div className="arc-loading arc-terminal-skeleton" data-loading="terminal" aria-busy="true"><LoadingStatus label={label} /><div className="arc-skeleton-content" aria-hidden="true"><Skeleton width="36%" /><Skeleton width="24%" /></div></div>;
  return <ListSkeleton label={label} />;
}

/** Used only before authenticated workspace data exists. No real panes unmount. */
export function WorkspaceOpening({ label = 'Opening your workspace', description = 'Checking your session and loading saved preferences.', error, onRetry }: {
  label?: string; description?: string; error?: string; onRetry?: () => void;
}) {
  return <main className="arc-workspace-opening">
    <div className="arc-opening-boot" aria-busy={!error}>
      <Logo size={56} label="Arc Workspace" />
      {error ? <><div className="arc-opening-error" role="alert"><h1>Couldn’t open the workspace.</h1><p>{error}</p></div>
        {onRetry && <button type="button" className="arc-opening-retry" onClick={onRetry}>Try again</button>}</>
        : <div className="arc-opening-track" aria-hidden="true"><span /></div>}
    </div>
    {!error && <p className="arc-opening-accessible" role="status" aria-live="polite">{label}. {description}</p>}
  </main>;
}
