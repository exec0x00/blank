import { memo, useId, useState } from 'react';
import { ChevronRight, Sparkles } from 'lucide-react';
import type { ReasoningSummarySegment } from '../../../shared/types';
import { MarkdownMessage } from './MarkdownMessage';
import './conversation-timeline.css';

interface TimelineReasoningProps {
  summary: ReasoningSummarySegment;
  live?: boolean;
  revised?: boolean;
  inGroup?: boolean;
  workspacePath: string;
  onNotify: (message: string, kind?: 'error' | 'success' | 'info') => void;
  onOpenFile?: (path: string, location?: { line: number; column?: number }) => void;
}

/** Only the provider's public summary is accepted here; private fields have no rendering path. */
export const TimelineReasoning = memo(function TimelineReasoning({ summary, live, revised, inGroup, workspacePath, onNotify, onOpenFile }: TimelineReasoningProps) {
  const updating = !!live && summary.status === 'streaming';
  const [choice, setChoice] = useState(false);
  const [opened, setOpened] = useState(false);
  const expanded = inGroup || choice;
  const triggerId = useId(), detailsId = useId();

  if (!summary.text.trim()) return null;

  const metadata = <>
      {updating && !inGroup && <small>Updating</small>}
      {revised && !updating && <small>Updated</small>}
      {summary.truncated && <small>Truncated</small>}
    </>;
  return <section className={`chat-timeline-reasoning${expanded ? ' is-expanded' : ''}${inGroup ? ' in-activity-group' : ''}`} aria-label="Public reasoning summary" data-reasoning-section={summary.summaryIndex}>
    {inGroup ? (revised || summary.truncated) && <div className="chat-timeline-reasoning-heading">{metadata}</div>
    : <button type="button" id={triggerId} className="chat-timeline-reasoning-toggle" aria-expanded={expanded} aria-controls={detailsId} onClick={() => { setOpened(true); setChoice(!expanded); }}>
      <Sparkles size={14} aria-hidden="true" /><span>Reasoning summary</span>{metadata}
      <ChevronRight size={14} className="chat-timeline-reasoning-chevron" aria-hidden="true" />
    </button>}
    <div id={detailsId} className="chat-timeline-reasoning-body" hidden={!expanded} role={inGroup ? undefined : 'region'} aria-labelledby={inGroup ? undefined : triggerId} onPointerDownCapture={() => setChoice(true)} onFocusCapture={() => setChoice(true)}>
      {(expanded || opened) && <MarkdownMessage content={summary.text} workspacePath={workspacePath} onNotify={onNotify} onOpenFile={onOpenFile} />}
      {summary.truncated && <p className="chat-timeline-note">Summary truncated.</p>}
    </div>
  </section>;
});
