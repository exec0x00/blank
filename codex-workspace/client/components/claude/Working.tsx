import { memo, useEffect, useState } from 'react';

const elapsedLabel = (seconds: number) => seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, '0')}s`;

/** A calm, live status line shown while Claude is working and nothing else is streaming. */
export const WorkingIndicator = memo(function WorkingIndicator({ label, startedAt, tone }: { label: string; startedAt?: string; tone: string }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(timer); }, []);
  const started = startedAt ? new Date(startedAt).getTime() : now;
  const seconds = Math.max(0, Math.floor((now - started) / 1000));
  return <div className={`claude-working is-${tone}`} role="status" aria-live="polite">
    <span className="claude-orb" aria-hidden="true"><i /></span>
    <span className="claude-working-label" key={label}>{label}</span>
    <span className="claude-working-meta">{elapsedLabel(seconds)}<kbd>esc</kbd> to stop</span>
  </div>;
});

/** Context window usage as a small ring that fills and warms up as it grows. */
export function ContextRing({ percent, title }: { percent: number; title: string }) {
  const radius = 6.5, circumference = 2 * Math.PI * radius;
  const level = percent >= 85 ? 'is-critical' : percent >= 60 ? 'is-high' : '';
  return <span className={`claude-context ${level}`} title={title} aria-label={title}>
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="8" cy="8" r={radius} className="claude-context-track" />
      <circle cx="8" cy="8" r={radius} className="claude-context-value" strokeDasharray={circumference}
        strokeDashoffset={circumference * (1 - Math.min(100, Math.max(0, percent)) / 100)} />
    </svg>
    <span>{percent}%</span>
  </span>;
}
