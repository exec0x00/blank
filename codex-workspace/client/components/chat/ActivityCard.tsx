import { memo, useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { BookOpen, Bot, Check, ChevronRight, Circle, CircleAlert, CircleHelp, ClipboardList, Clock3, ExternalLink, FileCode2, Folder, FolderSearch, Globe2, Image, Link2, LoaderCircle, PencilLine, Search, ShieldCheck, Target, Terminal, Wrench } from 'lucide-react';
import type { ToolActivity } from '../../../shared/types';
import { CopyButton } from './MarkdownMessage';
import { GeneratedImageCard, type GeneratedImageScope } from './GeneratedImageCard';
import { HistoryDetail, type HistoryDetailTarget } from './HistoryDetail';
import { NativeItemDetail, type NativeItemDetailTarget } from './NativeItemDetail';
import { PlanCard } from './PlanCard';
import { useToolDetailScope } from './ToolDetailScope';
import { hasNativeItemIdentity, toolHistoryDetailTarget } from './history-detail-presentation';
import { isRoutineTurnActivity } from './lifecycle-presentation';
import { activityChangeReviewTarget, isChangeActivity, type OpenChange } from '../editor/change-review';
import { formatToolActivity, safeWebSourceUrl, workspaceFileTarget, type ToolRow, type ToolSection, type ToolViewKind } from './tool-presentation';
import './tool-results.css';
import '../editor/change-review.css';

type Notify = (message: string, kind?: 'error' | 'success' | 'info') => void;
type OpenFile = (path: string, location?: { line: number; column?: number }) => void;
export interface ActivityCardProps {
  activity: ToolActivity;
  onNotify: Notify;
  workspacePath?: string;
  onOpenFile?: OpenFile;
  onOpenChange?: OpenChange;
  generatedImageScope?: GeneratedImageScope;
}

type DetailTarget = { kind: 'native'; target: NativeItemDetailTarget } | { kind: 'saved'; target: HistoryDetailTarget };

const ICONS: Record<ToolViewKind, typeof Terminal> = {
  command: Terminal, file: FileCode2, files: FolderSearch, search: Search, web: Globe2,
  changes: PencilLine, plan: ClipboardList, goal: Target, skill: BookOpen,
  agent: Bot, question: CircleHelp, image: Image, hook: Wrench, time: Clock3, generic: Wrench,
};

function CodeDetail({ section, onNotify, live }: { section: Extract<ToolSection, { type: 'code' }>; onNotify: Notify; live: boolean }) {
  const id = useId();
  const scroll = useRef<HTMLPreElement>(null);
  const following = useRef(true);
  useEffect(() => {
    const element = scroll.current;
    if (live && following.current && element) element.scrollTop = element.scrollHeight;
  }, [section.text, live]);
  return <section className={`response-tool-code${section.language === 'diff' ? ' is-diff' : ''}`} aria-labelledby={id}>
    <div className="response-tool-section-heading"><span id={id}>{section.title}</span><CopyButton text={section.text} label={`Copy ${section.title.toLowerCase()}${section.truncated ? ' preview' : ''}`} onNotify={onNotify} /></div>
    <pre ref={scroll} tabIndex={0} aria-label={section.title} onScroll={() => {
      const element = scroll.current;
      if (element) following.current = element.scrollHeight - element.scrollTop - element.clientHeight < 28;
    }}><code>{section.text}</code></pre>
    {section.truncated && <p className="response-tool-limit">Preview limited to 40,000 characters. Copy includes the displayed preview.</p>}
  </section>;
}

function ResultRow({ row, index, variant, workspacePath, onOpenFile, onReviewPath }: { row: ToolRow; index: number; variant: Extract<ToolSection, { type: 'rows' }>['variant']; workspacePath: string; onOpenFile?: OpenFile; onReviewPath?: (path: string, part?: number) => void }) {
  const review = variant === 'files' && onReviewPath;
  const target = row.path && onOpenFile ? workspaceFileTarget(row.path, workspacePath) : null;
  const sourceUrl = variant === 'sources' ? safeWebSourceUrl(row.url) : null;
  const Icon = variant === 'plan' ? row.status === 'completed' ? Check : row.status === 'in_progress' ? LoaderCircle : Circle : variant === 'sources' ? Globe2 : variant === 'queries' ? Search : variant === 'agents' ? Bot : variant === 'catalog' ? BookOpen : row.kind === 'directory' ? Folder : row.kind === 'symlink' ? Link2 : FileCode2;
  const planStatus = row.status === 'completed' ? 'Completed' : row.status === 'in_progress' ? 'In progress' : 'Pending';
  const content = <>
    <Icon size={14} aria-hidden="true" className={`response-tool-row-icon${variant === 'plan' && row.status === 'in_progress' ? ' response-tool-plan-active' : ''}`} />
    <span className="response-tool-row-copy">
      <span className="response-tool-row-title">{row.title}</span>
      {row.detail && (variant === 'search' ? <code className="response-tool-match">{row.detail}</code> : <span className="response-tool-row-detail">{row.detail}</span>)}
      {row.truncated && <span className="response-tool-limit">Item preview truncated.</span>}
    </span>
    {variant === 'plan' ? <span className={`response-tool-row-badge${row.status === 'in_progress' ? ' is-current' : ''}`}>{planStatus}</span> : row.badge && <span className="response-tool-row-badge">{row.badge}</span>}
    {sourceUrl ? <ExternalLink size={12} aria-hidden="true" className="response-tool-open-icon" /> : (target || review) && <ChevronRight size={12} aria-hidden="true" className="response-tool-open-icon" />}
  </>;
  return <li className={`response-tool-row is-${variant}${row.status ? ` is-${row.status}` : ''}`}>
    {review ? <button type="button" className="response-tool-file-link" title={`Review changes to ${row.title}`} aria-label={`Review changes to ${row.title}`} onClick={() => review(row.path ?? row.title, index)}>{content}</button> : sourceUrl ? <a className="response-tool-source-link" href={sourceUrl} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer" aria-label={`Open ${row.title} (opens in a new tab)`}>{content}</a> : target ? <button type="button" className="response-tool-file-link" title={`Open ${row.path}${row.line ? ` at line ${row.line}` : ''}`} aria-label={`Open ${row.path}${row.line ? ` at line ${row.line}` : ''}`} onClick={() => onOpenFile!(target, row.line ? { line: row.line, ...(row.column ? { column: row.column } : {}) } : undefined)}>{content}</button> : <div className="response-tool-row-content">{content}</div>}
  </li>;
}

function ResultSection({ section, workspacePath, onOpenFile, onReviewPath, onNotify, live }: { section: ToolSection; workspacePath: string; onOpenFile?: OpenFile; onReviewPath?: (path: string, part?: number) => void; onNotify: Notify; live: boolean }) {
  const id = useId();
  if (section.type === 'code') return <CodeDetail section={section} onNotify={onNotify} live={live} />;
  if (section.type === 'text') return <section className="response-tool-text" aria-labelledby={section.title ? id : undefined}>
    {section.title && <div className="response-tool-section-label" id={id}>{section.title}</div>}
    <p>{section.text}</p>
    {section.truncated && <p className="response-tool-limit">Text preview truncated.</p>}
  </section>;
  if (section.type === 'facts') return <dl className="response-tool-facts">{section.facts.map((fact, index) => <div key={`${index}-${fact.label}`}><dt>{fact.label}</dt><dd>{fact.value}</dd></div>)}</dl>;
  return <section className={`response-tool-rows is-${section.variant}`} aria-labelledby={section.title ? id : undefined}>
    {section.title && <div className="response-tool-section-label" id={id}>{section.title}</div>}
    {section.rows.length ? <ul tabIndex={section.rows.length > 8 ? 0 : undefined} aria-label={section.title ?? (section.variant === 'plan' ? 'Plan steps' : 'Tool results')}>
      {section.rows.map((row, index) => <ResultRow key={`${index}-${row.title}`} row={row} index={index} variant={section.variant} workspacePath={workspacePath} onOpenFile={onOpenFile} onReviewPath={onReviewPath} />)}
    </ul> : section.empty && <p className="response-tool-empty">{section.empty}</p>}
    {!!section.omitted && <p className="response-tool-limit">{section.omitted} more {section.omitted === 1 ? 'item is' : 'items are'} outside this preview.</p>}
  </section>;
}

export const ActivityCard = memo(function ActivityCard({ activity, onNotify, workspacePath = '', onOpenFile, onOpenChange, generatedImageScope }: ActivityCardProps) {
  const scope = useToolDetailScope();
  const view = useMemo(() => formatToolActivity(activity), [activity.name, activity.input, activity.output, activity.status, activity.inputTruncated, activity.outputTruncated]);
  const change = isChangeActivity(activity);
  const openChange = onOpenChange ?? scope?.onOpenChange;
  const reviewTarget = scope && change ? activityChangeReviewTarget(scope, activity) : null;
  const canReview = !!openChange && !!reviewTarget && !scope?.locked;
  const reviewPath = (path?: string, part?: number) => { if (canReview && reviewTarget && document.body.dataset.workspaceLocked !== 'true') openChange!({ ...reviewTarget, ...(path ? { path } : {}), ...(reviewTarget.source === 'native-item' && part !== undefined ? { part } : {}) }); };
  const details = useMemo<DetailTarget[]>(() => {
    if (!scope || change) return [];
    const native = scope.backend === 'codex-cli';
    if (native ? !scope.turnId || !hasNativeItemIdentity(scope.messageId) : !scope.epoch) return [];
    const name = activity.name.replace(/^(?:functions|tools)\./, '');
    const clipped = (field: 'input' | 'output') => view.sections.some(section => section.field === field
      && (section.type === 'code' || section.type === 'text') && section.truncated);
    const input = activity.inputTruncated || clipped('input');
    const output = activity.outputTruncated || clipped('output') || native && name === 'apply_patch' && input;
    return (['input', 'output'] as const).flatMap(field => {
      if (!(field === 'input' ? input : output)) return [];
      const target = toolHistoryDetailTarget({ threadId: scope.threadId, epoch: scope.epoch ?? '', messageId: scope.messageId }, activity, field);
      const label = native && name === 'apply_patch' ? field === 'input' ? 'File paths' : 'File changes' : target.label.replace(/^Full /, '').replace(/^./, first => first.toUpperCase());
      return [native ? { kind: 'native', target: { workspaceId: scope.workspaceId, threadId: scope.threadId, turnId: scope.turnId!, itemId: scope.messageId, field, label } }
        : { kind: 'saved', target: { ...target, label } }];
    });
  }, [scope, change, activity.id, activity.name, activity.inputTruncated, activity.outputTruncated, view]);
  const detailedFields = new Set(details.map(detail => detail.target.field));
  const sections = view.sections.filter(section => !(change && section.type === 'code')).filter(section => !(section.type === 'code' || section.type === 'text')
    || !detailedFields.has(section.field ?? 'output') && !(scope?.backend === 'codex-cli' && view.kind === 'changes' && detailedFields.has('output')));
  const initialExpanded = view.status === 'error' || view.status === 'awaiting_approval' || view.kind === 'plan';
  const [localExpanded, setLocalExpanded] = useState(initialExpanded);
  const expanded = scope?.expanded ?? localExpanded;
  const onExpandedChange = scope?.onExpandedChange;
  const setExpanded = useCallback((value: boolean | ((previous: boolean) => boolean)) => {
    const next = typeof value === 'function' ? value(expanded) : value;
    setLocalExpanded(next); onExpandedChange?.(next);
  }, [expanded, onExpandedChange]);
  const [opened, setOpened] = useState(initialExpanded);
  const bodyId = useId(), triggerId = useId();
  const Icon = ICONS[view.kind];
  const statusIcon = view.status === 'running' ? scope?.grouped ? <Circle size={13} aria-hidden="true" /> : <LoaderCircle size={13} className="chat-spin" aria-hidden="true" /> : view.status === 'error' ? <CircleAlert size={13} aria-hidden="true" /> : view.status === 'awaiting_approval' ? <ShieldCheck size={13} aria-hidden="true" /> : view.status === 'awaiting_input' ? <CircleHelp size={13} aria-hidden="true" /> : view.statusLabel === 'Still running' ? <Clock3 size={13} aria-hidden="true" /> : <Check size={13} aria-hidden="true" />;

  useEffect(() => {
    if (scope?.expanded === undefined && (view.status === 'error' || view.status === 'awaiting_approval')) { setExpanded(true); setOpened(true); }
  }, [view.status]);
  useEffect(() => { if (expanded) setOpened(true); }, [expanded]);

  if (isRoutineTurnActivity(activity)) return null;

  if ((activity.status === 'completed' || activity.status === 'error') && activity.generatedImage && ['generate_image', 'read_generated_image'].includes(activity.name.replace(/^(?:functions|tools)\./, ''))) {
    const activityError = view.status === 'error' ? view.notices.filter(notice => notice.kind === 'error').map(notice => notice.text).join(' ').slice(0, 1000) || view.summary || 'The request did not complete.' : undefined;
    return <GeneratedImageCard image={activity.generatedImage} scope={generatedImageScope} onNotify={onNotify} activityError={activityError} />;
  }

  return <div className={`chat-activity is-${view.status} response-tool is-${view.kind}${expanded ? ' is-expanded' : ''}`}>
    <button type="button" id={triggerId} className="chat-activity-summary" aria-expanded={expanded} aria-controls={bodyId} onClick={() => { setOpened(true); setExpanded(value => !value); }}>
      <Icon size={15} className="chat-activity-icon" aria-hidden="true" />
      <span className="chat-activity-label">
        <span className="response-tool-action">{view.label}</span>
        {view.preview && <code title={view.preview}>{view.preview}</code>}
        {view.summary && <span className="response-tool-summary">{view.summary}</span>}
      </span>
      <span className={`chat-activity-status is-${view.status}`}>
        {statusIcon}<span className="response-tool-status-label">{view.statusLabel}</span>
      </span>
      <ChevronRight size={13} className="chat-activity-chevron" aria-hidden="true" />
    </button>
    {change && <div className="response-tool-review-action">{reviewTarget ? <button type="button" disabled={!canReview} onClick={() => reviewPath()}><PencilLine size={13} aria-hidden="true" />Open changes</button> : <span>Recorded patch unavailable</span>}</div>}
    {view.truncated && !details.length && <div className="response-tool-partial"><CircleAlert size={12} aria-hidden="true" />Partial result</div>}
    {!scope?.grouped && <span className="chat-sr-only" role="status" aria-live="polite" aria-atomic="true">{view.label}: {view.statusLabel}.{view.truncated ? change && canReview ? ' Open changes to read recorded content.' : details.length ? expanded ? ' Content is paged.' : ' Expand to read paged content.' : ' Result is partial.' : ''}</span>}
    <div className="chat-activity-body" id={bodyId} role="region" aria-labelledby={triggerId} hidden={!expanded}>
      {(expanded || opened) && <>
        {view.notices.length > 0 && <ul className="response-tool-notices" aria-label="Tool notices">{view.notices.map((notice, index) => <li key={`${index}-${notice.kind}`} className={`is-${notice.kind}`}><CircleAlert size={13} aria-hidden="true" /><span>{notice.text}</span></li>)}</ul>}
        {sections.map((section, index) => section.type === 'rows' && section.variant === 'plan'
          ? <PlanCard key={`${index}-${section.type}`} rows={section.rows} omitted={section.omitted} locked={scope?.locked}
            explanation={sections.flatMap(part => part.type === 'text' ? [part.text] : []).join('\n\n')} />
          : <ResultSection key={`${index}-${section.type}`} section={section} workspacePath={workspacePath} onOpenFile={change ? undefined : onOpenFile} onReviewPath={change && canReview ? reviewPath : undefined} onNotify={onNotify} live={activity.status === 'running' && expanded} />)}
        {details.map(detail => detail.kind === 'native'
          ? <NativeItemDetail key={detail.target.field} target={detail.target} inline active={expanded && scope?.visible !== false} locked={scope?.locked}
            sourceVersion={activity.status + ':' + (detail.target.field === 'input' ? activity.input : activity.output)} onClose={() => setExpanded(false)} onNotify={onNotify} />
          : <HistoryDetail key={detail.target.field} target={detail.target} inline active={expanded && scope?.visible !== false} locked={scope?.locked}
            sourceVersion={activity.status + ':' + (detail.target.field === 'input' ? activity.input : activity.output)} onClose={() => setExpanded(false)} onNotify={onNotify} />)}
      </>}
    </div>
  </div>;
});
