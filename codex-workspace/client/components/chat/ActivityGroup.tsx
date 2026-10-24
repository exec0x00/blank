import { Fragment, memo, useId, useState, type ReactNode } from 'react';
import { Check, ChevronRight, Circle, CircleAlert, CircleHelp, CirclePause, ShieldCheck } from 'lucide-react';
import { activityGroupDetails, activityGroupPresentation, type TimelineActivityEntry, type TimelineActivityGroup } from './activity-groups';
import { ActivityPulse } from './ResponseActivity';
import './activity-groups.css';

interface ActivityGroupProps {
  group: TimelineActivityGroup;
  expanded: boolean;
  motionAllowed?: boolean;
  onExpandedChange: (expanded: boolean) => void;
  renderEntry: (entry: TimelineActivityEntry, visible: boolean) => ReactNode;
}

/** One quiet disclosure owns progress; details retain their canonical order. */
export const ActivityGroup = memo(function ActivityGroup({ group, expanded, motionAllowed = true, onExpandedChange, renderEntry }: ActivityGroupProps) {
  const [opened, setOpened] = useState(expanded);
  const triggerId = useId(), detailsId = useId();
  const view = activityGroupPresentation(group);
  const Icon = view.status === 'approval' ? ShieldCheck : view.status === 'input' ? CircleHelp : view.status === 'error' ? CircleAlert
    : view.status === 'interrupted' ? CirclePause : view.status === 'recorded' ? Circle : Check;
  const status = `${view.label}${view.failedCount ? `, ${view.failedCount} ${view.failedCount === 1 ? 'action' : 'actions'} failed` : ''}`;
  const showState = view.attention || view.animating && view.action !== view.label;
  const description = `${status}${view.action === view.label ? '' : `. ${view.action}`}${view.preview ? `: ${view.preview}` : ''}`;
  return <section className={`chat-activity-group${expanded ? ' is-expanded' : ''}${view.animating ? ' is-current' : ''}${view.attention ? ' needs-attention' : ''}`}
    aria-label="Activity" data-timeline-entry={group.key} data-timeline-entries={JSON.stringify(group.entryKeys)} data-activity-status={view.status}>
    <button type="button" id={triggerId} className="chat-activity-group-toggle" aria-expanded={expanded} aria-controls={detailsId}
      aria-label={['Activity', view.count, description].filter(Boolean).join(', ')}
      onClick={() => { setOpened(true); onExpandedChange(!expanded); }}>
      {view.animating ? <ActivityPulse active={motionAllowed} className="chat-activity-group-icon" /> : <Icon size={15} aria-hidden="true" className="chat-activity-group-icon" />}
      <span className="chat-activity-group-action">{view.action}</span>
      {view.preview && <code className="chat-activity-group-preview">{view.preview}</code>}
      <span className="chat-activity-group-count" aria-hidden={!view.count || undefined}>{view.count}</span>
      {showState && <span className="chat-activity-group-state">{view.label}</span>}
      {view.failedCount > 0 && view.status !== 'error' && <span className="chat-activity-group-state">{view.failedCount} failed</span>}
      <ChevronRight size={14} className="chat-activity-group-chevron" aria-hidden="true" />
    </button>
    {group.current && <span className="chat-sr-only" role="status" aria-live="polite" aria-atomic="true">{description}.</span>}
    <div id={detailsId} className="chat-activity-group-details" hidden={!expanded} role="region" aria-labelledby={triggerId}>
      {(expanded || opened) && <ol className="chat-activity-group-list">
        {activityGroupDetails(group.entries).map(detail => <li key={detail.key} className={`chat-activity-group-entry is-${detail.kind}`}
          data-reasoning-item={detail.kind === 'reasoning' ? detail.itemId : undefined}>
          {detail.kind === 'activity' ? renderEntry(detail.entry, expanded) : <div className="chat-activity-reasoning-sections">
            {detail.entries.map(entry => <Fragment key={entry.key}>{renderEntry(entry, expanded)}</Fragment>)}
          </div>}
        </li>)}
      </ol>}
    </div>
  </section>;
});
