import { memo, useId, useMemo, useState } from 'react';
import { ChevronDown, ExternalLink, Link2 } from 'lucide-react';
import type { WebCitation } from '../../../shared/types';
import { answerSources } from './citations';
import './message-citations.css';

const PREVIEW_COUNT = 3;

export const MessageCitations = memo(function MessageCitations({ citations }: { citations?: readonly WebCitation[] }) {
  const sources = useMemo(() => answerSources(citations), [citations]);
  const [expanded, setExpanded] = useState(false);
  const listId = useId();
  if (!sources.length) return null;
  const shown = expanded ? sources : sources.slice(0, PREVIEW_COUNT);
  return <aside className="chat-citations" aria-label="Sources for this answer">
    <div className="chat-citations-heading"><Link2 size={13} aria-hidden="true" /><span>Sources</span><span className="chat-citations-count">{sources.length}</span></div>
    <ul id={listId} className="chat-citations-list">
      {shown.map(source => <li key={source.key}><a href={source.url} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer" title={source.title}>
        <span className="chat-citation-text"><span className="chat-citation-title">{source.title}</span>{source.title !== source.host && <span className="chat-citation-host">{source.host}</span>}</span><ExternalLink size={13} aria-hidden="true" />
      </a></li>)}
    </ul>
    {sources.length > PREVIEW_COUNT && <button type="button" className="chat-citations-more" aria-expanded={expanded} aria-controls={listId} onClick={() => setExpanded(value => !value)}><ChevronDown size={13} aria-hidden="true" /><span>{expanded ? 'Show fewer sources' : `Show ${sources.length - PREVIEW_COUNT} more ${sources.length - PREVIEW_COUNT === 1 ? 'source' : 'sources'}`}</span></button>}
  </aside>;
});
