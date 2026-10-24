import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from 'react';
import type { ClaudeEffort, ClaudeModelOption } from '../../../../shared/claude';
import { EFFORT_LABELS } from '../catalog';
import { Check, Chevron, ChevronLeft, ChevronRight } from './icons';

interface Props {
  models: ClaudeModelOption[]; model: string; efforts: ClaudeEffort[]; effort: ClaudeEffort | null;
  open: boolean; onOpen: (open: boolean) => void; onModel: (id: string) => void; onEffort: (effort: ClaudeEffort | null) => void;
}

/** One control for the model and its reasoning effort: a sliding pane per choice. */
export function ModelPicker({ models, model, efforts, effort, open, onOpen, onModel, onEffort }: Props) {
  const [pane, setPane] = useState<'effort' | 'models'>('effort');
  const [instant, setInstant] = useState(true);
  const viewport = useRef<HTMLDivElement>(null);
  const effortPane = useRef<HTMLElement>(null);
  const modelPane = useRef<HTMLElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const label = models.find(item => item.id === model)?.label ?? model;
  const auto = effort === null || !efforts.includes(effort);

  useEffect(() => {
    if (!open) return;
    setPane('effort'); setInstant(true);
    const frame = requestAnimationFrame(() => requestAnimationFrame(() => setInstant(false)));
    const top = pop.current?.offsetParent?.getBoundingClientRect().top ?? 400;
    if (pop.current) pop.current.style.maxHeight = `${Math.max(140, top - 18)}px`;
    return () => cancelAnimationFrame(frame);
  }, [open]);
  // The popover height follows whichever pane is showing.
  useLayoutEffect(() => {
    const fit = () => { const el = pane === 'models' ? modelPane.current : effortPane.current; if (viewport.current && el) viewport.current.style.height = `${el.offsetHeight}px`; };
    fit();
    const observer = new ResizeObserver(fit);
    if (effortPane.current) observer.observe(effortPane.current);
    if (modelPane.current) observer.observe(modelPane.current);
    return () => observer.disconnect();
  }, [pane, open, efforts.length]);

  return <div className="qc-anchor qc-mp-anchor">
    <button type="button" className={`qc-mpick${open ? ' active' : ''}`} aria-haspopup="true" aria-expanded={open} aria-label={`Model ${label}, effort ${auto ? 'auto' : EFFORT_LABELS[effort!]}`}
      onClick={() => onOpen(!open)}>
      <span className="qc-mp-name" key={label}>{label}</span>
      {efforts.length > 0 && <span className="qc-mp-eff" key={String(effort)}>{auto ? 'Auto' : EFFORT_LABELS[effort!]}</span>}
      <Chevron size={12} />
    </button>
    <div ref={pop} className={`qc-pop right qc-mp-pop${open ? ' open' : ''}${pane === 'models' ? ' models' : ''}${auto ? ' is-auto' : ''}`}
      onKeyDown={event => { if (event.key === 'Escape' && pane === 'models') { event.stopPropagation(); setPane('effort'); } }}>
      <div ref={viewport} className={`qc-mp-viewport${instant ? ' instant' : ''}`}>
        <div className="qc-mp-track">
          <section ref={effortPane} className="qc-mp-pane qc-pane-effort" aria-hidden={pane === 'models'}>
            <button type="button" className="qc-mp-model" aria-label="Change model" onClick={() => setPane('models')}>
              <span className="qc-mp-model-n">{label}</span><span className="qc-mp-go"><ChevronRight /></span>
            </button>
            {efforts.length > 0 && <>
              <div className="qc-pop-h"><span>Reasoning effort</span>
                <button type="button" className="qc-auto-btn" aria-pressed={auto} onClick={() => onEffort(auto ? efforts[Math.min(2, efforts.length - 1)] : null)}><span className="qc-ad" />Auto</button></div>
              <EffortSlider efforts={efforts} value={auto ? null : effort} onChange={onEffort} />
            </>}
          </section>
          <section ref={modelPane} className="qc-mp-pane qc-pane-model" aria-hidden={pane !== 'models'}>
            <div className="qc-pop-h qc-mp-back-h"><button type="button" className="qc-mp-back" onClick={() => setPane('effort')}><ChevronLeft />Model</button></div>
            <div role="menu">{models.map((item, index) => <button type="button" role="menuitemradio" aria-checked={item.id === model} key={item.id}
              className={`qc-item${item.id === model ? ' sel' : ''}`} style={{ '--i': index } as CSSProperties}
              onClick={() => { onModel(item.id); window.setTimeout(() => setPane('effort'), 180); }}>
              <span className="qc-body"><span className="qc-t">{item.label}{item.tag && <span className="qc-tag">{item.tag}</span>}</span>{item.description && <span className="qc-d">{item.description}</span>}</span><Check /></button>)}</div>
          </section>
        </div>
      </div>
    </div>
  </div>;
}

/** A stepped slider: notches light up as the thumb passes them. */
function EffortSlider({ efforts, value, onChange }: { efforts: ClaudeEffort[]; value: ClaudeEffort | null; onChange: (effort: ClaudeEffort) => void }) {
  const max = Math.max(1, efforts.length - 1);
  const index = value ? Math.max(0, efforts.indexOf(value)) : Math.min(2, efforts.length - 1);
  const [drag, setDrag] = useState<number | null>(null);
  const [ping, setPing] = useState(-1);
  const rail = useRef<HTMLDivElement>(null);
  const shown = drag ?? index / max;
  const shownIndex = Math.round(shown * max);
  const last = useRef(shownIndex);
  useEffect(() => {
    if (last.current === shownIndex) return;
    last.current = shownIndex; setPing(shownIndex);
    const timer = window.setTimeout(() => setPing(-1), 180);
    return () => window.clearTimeout(timer);
  }, [shownIndex]);
  const at = (event: PointerEvent) => { const rect = rail.current!.getBoundingClientRect(); return Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)); };
  const key = (event: KeyboardEvent) => {
    const go = (next: number) => { event.preventDefault(); onChange(efforts[Math.max(0, Math.min(max, next))]); };
    if (event.key === 'ArrowRight' || event.key === 'ArrowUp') go(index + 1);
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') go(index - 1);
    else if (event.key === 'Home') go(0);
    else if (event.key === 'End') go(max);
  };
  return <div className="qc-effort-body">
    <div className={`qc-slider${drag !== null ? ' dragging' : ''}`} role="slider" tabIndex={0} aria-label="Reasoning effort" aria-valuemin={0} aria-valuemax={max}
      aria-valuenow={index} aria-valuetext={EFFORT_LABELS[efforts[index]]} onKeyDown={key}
      onPointerDown={event => { event.currentTarget.setPointerCapture(event.pointerId); setDrag(at(event)); }}
      onPointerMove={event => { if (drag !== null) setDrag(at(event)); }}
      onPointerUp={event => { if (drag === null) return; onChange(efforts[Math.round(at(event) * max)]); setDrag(null); }}
      onPointerCancel={() => setDrag(null)}>
      <div ref={rail} className="qc-rail" style={{ '--p': shown } as CSSProperties}>
        <div className="qc-track" />
        <div className="qc-fillclip"><div className="qc-fill" /></div>
        {efforts.map((item, position) => <span key={item} className={`qc-notch${position <= shownIndex ? ' lit' : ''}${position === ping ? ' ping' : ''}`} style={{ left: `${position / max * 100}%` }} />)}
        <div className="qc-tpos"><div className="qc-thumb" /></div>
      </div>
    </div>
    <div className="qc-labels">{efforts.map((item, position) => <button type="button" key={item} className={position === shownIndex ? 'on' : ''}
      style={{ left: `${position / max * 100}%` }} onClick={() => onChange(item)}>{EFFORT_LABELS[item]}</button>)}</div>
  </div>;
}
