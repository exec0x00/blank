import { memo, useEffect, useRef, useState } from 'react';
import './response-activity.css';

/** This observes the page, not the stream. It never schedules rendering frames. */
function useForeground() {
  const [foreground, setForeground] = useState(() => typeof document !== 'undefined' && !document.hidden && document.hasFocus());
  useEffect(() => {
    const read = () => setForeground(!document.hidden && document.hasFocus());
    const pause = () => setForeground(false);
    document.addEventListener('visibilitychange', read);
    window.addEventListener('focus', read);
    window.addEventListener('blur', pause);
    window.addEventListener('pagehide', pause);
    window.addEventListener('pageshow', read);
    read();
    return () => {
      document.removeEventListener('visibilitychange', read);
      window.removeEventListener('focus', read);
      window.removeEventListener('blur', pause);
      window.removeEventListener('pagehide', pause);
      window.removeEventListener('pageshow', read);
    };
  }, []);
  return foreground;
}

/** A single quiet activity mark; geometry stays fixed in every state. */
export const ActivityPulse = memo(function ActivityPulse({ active, className = '' }: { active: boolean; className?: string }) {
  const foreground = useForeground();
  const target = useRef<HTMLSpanElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (!target.current || typeof IntersectionObserver === 'undefined') { setVisible(true); return; }
    const observer = new IntersectionObserver(entries => setVisible(entries.some(entry => entry.isIntersecting)));
    observer.observe(target.current);
    return () => observer.disconnect();
  }, []);
  return <span ref={target} className={`arc-activity-pulse ${className}`} aria-hidden="true" data-active={active && foreground && visible}>
    <i /><i /><i />
  </span>;
});

export interface ResponseSample { id: string; length: number }
interface ResponseActivityProps {
  scope: string;
  label: string;
  connected: boolean;
  sample?: ResponseSample;
}

/**
 * The status may acknowledge newly arriving public text, but text itself always
 * renders immediately. A baseline on mount/reconnect prevents history playback.
 * No character timers, synthetic progress or copied response nodes are used.
 */
export const ResponseActivity = memo(function ResponseActivity({ scope, label, connected, sample }: ResponseActivityProps) {
  const foreground = useForeground();
  const eligible = connected && foreground && label === 'Working';
  const baseline = useRef<{ scope: string; eligible: boolean; sample?: ResponseSample } | undefined>(undefined);
  const [recentScope, setRecentScope] = useState<string | null>(null);
  const expiry = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    const previous = baseline.current;
    baseline.current = { scope, eligible, sample };
    if (!eligible || previous?.scope !== scope || !previous.eligible) {
      clearTimeout(expiry.current); setRecentScope(null); return;
    }
    if (sample && sample.length > 0 && (sample.id !== previous.sample?.id || sample.length > previous.sample.length)) {
      clearTimeout(expiry.current);
      setRecentScope(scope);
      expiry.current = setTimeout(() => setRecentScope(null), 1800);
    }
  }, [scope, eligible, sample?.id, sample?.length]);
  useEffect(() => () => clearTimeout(expiry.current), []);
  const responding = eligible && recentScope === scope;
  const moving = connected && (label === 'Working' || label === 'Compacting context');
  return <div className="chat-working chat-response-activity" role="status" aria-live="polite" aria-atomic="true" data-response-state={responding ? 'receiving' : connected ? 'waiting' : 'paused'}>
    <ActivityPulse active={moving} />
    <span>{!connected ? 'Waiting for updates' : responding ? 'Responding' : label}</span>
  </div>;
});
