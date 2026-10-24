import { useId, useState } from 'react';
import { AlertCircle, CircleGauge, LoaderCircle, Minimize2, RefreshCw } from 'lucide-react';
import type { CodexTokenBreakdown, CodexTokenUsage } from '../../../shared/codex-cli';
import Modal from '../Modal';
import PageNavigation from '../ui/PageNavigation';
import { exactTokenCount } from './compact-number';
import { contextDescription, currentContext } from './context-presentation';
import type { NativeContextDetails, useContextDetails } from './useContextDetails';
import './context-controls.css';

export function ContextIndicator({ tokenUsage, compacting = false, onClick, disabled }: {
  tokenUsage?: CodexTokenUsage | null; compacting?: boolean; onClick: () => void; disabled?: boolean;
}) {
  const id = useId(), description = contextDescription(tokenUsage), current = currentContext(tokenUsage);
  return <><button type="button" className="chat-context-trigger" aria-label="Context and usage" aria-describedby={id} aria-busy={compacting} data-reported={current.count !== undefined}
    data-tooltip={description} onClick={onClick} disabled={disabled}>
    {compacting ? <LoaderCircle size={13} className="chat-spin" /> : <CircleGauge size={13} />}<span>{compacting ? 'Compacting' : 'Context'}</span>
    {!compacting && <small aria-hidden="true">{current.compact}</small>}
  </button><span className="chat-sr-only" id={id}>{description}</span></>;
}
function ContextSnapshot({ usage, model }: { usage?: CodexTokenUsage | null; model?: string | null }) {
  const current = currentContext(usage);
  return <div className="chat-context-snapshot"><div className="chat-context-snapshot-heading"><span><CircleGauge size={15} />{current.label}</span>{model && <code className="text-ellipsis" data-tooltip={model} aria-label={'Current conversation model: ' + model}>{model}</code>}</div>
    <div className="chat-context-value"><strong>{exactTokenCount(current.count, 'Not reported')}</strong>{current.count !== undefined && <span>{current.limit ? '/ ' + exactTokenCount(current.limit) + ' tokens' : 'tokens'}</span>}</div>
    {current.limit !== undefined && current.count !== undefined && <progress className="chat-context-meter" value={Math.min(current.limit, current.count)} max={current.limit} aria-label="Context window" aria-valuetext={contextDescription(usage)} />}
    <p className="chat-context-explanation">{current.count === undefined ? 'Codex has not reported the current context for this conversation.'
      : <>Last reported by Codex{current.reportedAt && <> · <time dateTime={current.reportedAt}>{new Date(current.reportedAt).toLocaleString()}</time></>}. Later activity or model changes may have changed the context.</>}</p>
    {!current.limit && <p className="chat-context-note">The context window has not been reported.</p>}
  </div>;
}
const metrics: Array<{ key: keyof CodexTokenBreakdown; label: string }> = [
  { key: 'inputTokens', label: 'Input tokens' }, { key: 'outputTokens', label: 'Output tokens' },
  { key: 'cachedInputTokens', label: 'Cached input' }, { key: 'cacheWriteInputTokens', label: 'Cache-write input' },
  { key: 'reasoningOutputTokens', label: 'Reasoning output' }, { key: 'totalTokens', label: 'Total tokens' },
];
function sum(values: Array<CodexTokenUsage | null | undefined>, key: keyof CodexTokenBreakdown): number | undefined {
  if (values.some(value => !value || !Number.isSafeInteger(value.total[key]) || value.total[key] < 0)) return undefined;
  const total = values.reduce((result, value) => result + value!.total[key], 0);
  return Number.isSafeInteger(total) ? total : undefined;
}
export function ContextUsageBreakdown({ details }: { details: NativeContextDetails }) {
  const own = details.thread.native?.tokenUsage, children = details.children.map(child => child.native?.tokenUsage);
  return <section className="chat-context-section"><h3>Reported token usage</h3>
    <p className="chat-context-explanation">Accumulated native token usage for this conversation and its returned descendants. These totals are separate from context size; each conversation has its own context window.</p>
    <div className="chat-context-table-scroll" tabIndex={0} role="region" aria-label="Conversation token totals"><table className="chat-context-usage-table">
      <thead><tr><th scope="col">Usage</th><th scope="col">This conversation</th>{children.length > 0 && <><th scope="col">Subagents</th><th scope="col">Combined reported</th></>}</tr></thead>
      <tbody>{metrics.map(metric => <tr key={metric.key}><th scope="row">{metric.label}</th><td>{exactTokenCount(sum([own], metric.key))}</td>
        {children.length > 0 && <><td>{exactTokenCount(sum(children, metric.key))}</td><td>{exactTokenCount(sum([own, ...children], metric.key))}</td></>}
      </tr>)}</tbody></table></div>
    {(!own || children.some(value => !value)) && <p className="chat-context-note">Some native usage has not been reported. Missing reports are not counted as zero.</p>}
  </section>;
}
export function ContextDialog({ open, onClose, details, pending, disabled, error, onCompact }: {
  open: boolean; onClose: () => void; details: ReturnType<typeof useContextDetails>; pending: boolean;
  disabled: boolean; error: string | null; onCompact: () => void;
}) {
  const [page, setPage] = useState({ threadId: '', offset: 0 });
  const data = details.data, children = data?.children ?? [], last = Math.max(0, Math.ceil(children.length / 20) - 1) * 20;
  const offset = page.threadId === data?.thread.id ? Math.min(page.offset, last) : 0;
  return <Modal open={open} onClose={onClose} title="Context and usage" titleId="chat-context-title" className="chat-context-dialog">
    <div className="chat-context-body">
      <section aria-label="Selected conversation context">{data?.thread.title && <h3 className="text-ellipsis" data-tooltip={data.thread.title}>{data.thread.title}</h3>}<ContextSnapshot usage={data?.thread.native?.tokenUsage} model={data?.thread.native?.model} /></section>
      <div className="chat-context-refresh"><span role="status">{details.loading ? 'Reading native context…' : 'Reported conversation data'}</span>
        <button type="button" className="button ghost" aria-label="Refresh context details" disabled={details.loading} onClick={() => void details.refresh()}><RefreshCw size={13} />Refresh</button></div>
      {details.error && <p className="chat-control-dialog-error" role="alert"><AlertCircle size={14} />{details.error}</p>}
      {data && <ContextUsageBreakdown details={data} />}
      {!!children.length && <section className="chat-context-section"><h3>Subagent contexts</h3><ul className="chat-context-children">{children.slice(offset, offset + 20).map(child =>
        <li key={child.id} className="chat-context-child"><details><summary data-tooltip={child.title}><span className="chat-context-child-heading"><span className="text-ellipsis">{child.title}</span><span className="chat-context-child-status">{child.status.replaceAll('_', ' ')}</span></span></summary>
          <ContextSnapshot usage={child.native?.tokenUsage} model={child.native?.model} /></details></li>)}</ul>
        <PageNavigation label="Subagent contexts" offset={offset} count={Math.min(20, children.length - offset)} total={children.length}
          hasPrevious={offset > 0} hasNext={offset < last} onPrevious={() => setPage({ threadId: data!.thread.id, offset: Math.max(0, offset - 20) })}
          onNext={() => setPage({ threadId: data!.thread.id, offset: Math.min(last, offset + 20) })} /></section>}
      <section className="chat-context-compact"><div><Minimize2 size={16} /><h3>Compact context</h3></div><p>Ask Codex to compact this conversation using its native context management.</p>
        {error && <p role="alert" className="chat-control-dialog-error">{error}</p>}</section>
    </div>
    <div className="modal-footer"><button type="button" className="button ghost" onClick={onClose}>Close</button>
      <button type="button" className="button primary" disabled={disabled || pending} onClick={onCompact}>{pending ? <LoaderCircle size={14} className="chat-spin" /> : <Minimize2 size={14} />}Compact context</button>
    </div>
  </Modal>;
}
