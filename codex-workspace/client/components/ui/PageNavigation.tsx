import { ChevronLeft, ChevronRight, Loader2 } from 'lucide-react';
import './page-navigation.css';

interface Props {
  label: string;
  offset: number;
  count: number;
  total?: number;
  hasPrevious: boolean;
  hasNext: boolean;
  loading?: boolean;
  disabled?: boolean;
  onPrevious: () => void;
  onNext: () => void;
}

/** One server page is retained at a time. Controls keep their focus while the
 * requested page loads; failures leave the last successful page in place. */
export default function PageNavigation({ label, offset, count, total, hasPrevious, hasNext, loading = false, disabled = false, onPrevious, onNext }: Props) {
  if (!hasPrevious && !hasNext && !loading) return null;
  return <nav className="page-navigation" aria-label={`${label} pages`}>
    <button type="button" className="button ghost" onClick={() => { if (!disabled && !loading && hasPrevious) onPrevious(); }} disabled={disabled} aria-disabled={disabled || loading || !hasPrevious} aria-label={`Previous ${label.toLowerCase()}`}><ChevronLeft size={15} /><span>Previous</span></button>
    <span className="page-navigation-status" role="status" aria-live="polite">{loading ? <><Loader2 size={13} className="spin" />Loading…</> : count ? `${offset + 1}–${offset + count}${total === undefined ? '' : ` of ${total}`}` : 'No results on this page'}</span>
    <button type="button" className="button ghost" onClick={() => { if (!disabled && !loading && hasNext) onNext(); }} disabled={disabled} aria-disabled={disabled || loading || !hasNext} aria-label={`Next ${label.toLowerCase()}`}><span>Next</span><ChevronRight size={15} /></button>
  </nav>;
}
