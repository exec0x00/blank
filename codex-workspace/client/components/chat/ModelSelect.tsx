import { useMemo, useState } from 'react';
import PageNavigation from '../ui/PageNavigation';
import { SelectMenu } from '../ui/Dropdown';
import { retiredModel, validModelId, visibleModelOption, type ModelOption } from './models';

const PAGE_SIZE = 25;
interface Props {
  value: string; models: readonly ModelOption[]; onValueChange: (model: string) => void; label: string;
  id?: string; className?: string; compact?: boolean; disabled?: boolean; loading?: boolean;
  ready?: boolean; error?: string | null; onRefresh?: () => void;
}

export default function ModelSelect({ value, models, onValueChange, label, id, className, compact, disabled, loading, ready = true, error, onRefresh }: Props) {
  const [query, setQuery] = useState('');
  const [offset, setOffset] = useState(0);
  const filtered = useMemo(() => {
    const text = query.trim().toLocaleLowerCase();
    return text ? models.filter(model => `${model.displayName}\n${model.model}\n${model.description}`.toLocaleLowerCase().includes(text))
      : models.filter(model => visibleModelOption(model, value));
  }, [models, query, value]);
  const pageOffset = Math.min(offset, Math.max(0, Math.ceil(filtered.length / PAGE_SIZE) - 1) * PAGE_SIZE);
  const page = filtered.slice(pageOffset, pageOffset + PAGE_SIZE), current = models.find(model => model.model === value);
  const canChoose = !disabled && ready && !loading && !error && models.some(model => model.available);
  const literalChoice = !models.some(model => model.kind === 'native' && model.provider === 'bridge') && validModelId(query) && !retiredModel(query) && !models.some(model => model.model === query);
  const inputNotice = query && !validModelId(query) ? 'To use this as a model ID, enter 1–200 characters without outer spaces or control characters.'
    : query && retiredModel(query) ? 'This retired model is not offered.' : null;
  const previous = () => setOffset(Math.max(0, pageOffset - PAGE_SIZE));
  const next = () => { if (pageOffset + PAGE_SIZE < filtered.length) setOffset(pageOffset + PAGE_SIZE); };
  return <SelectMenu id={id} aria-label={label} value={value} onValueChange={selected => {
    if (canChoose && validModelId(selected) && !retiredModel(selected) && document.body.dataset.workspaceLocked !== 'true') onValueChange(selected);
  }} className={className} compact={compact} disabled={disabled}
    valueLabel={`${current?.displayName || value || 'Choose a model'}${current?.kind === 'literal' ? ' · model ID' : retiredModel(value) ? ' · not offered' : ''}`}
    searchable searchPlaceholder="Search or enter a model ID…" onOpenChange={open => { if (open) {
      const visible = models.filter(model => visibleModelOption(model, value));
      setQuery(''); setOffset(Math.max(0, Math.floor(visible.findIndex(model => model.model === value) / PAGE_SIZE)) * PAGE_SIZE); onRefresh?.();
    } }}
    renderValue={() => <span>{current?.displayName || value || 'Choose a model'}{current?.kind === 'literal' ? ' · model ID' : retiredModel(value) ? ' · not offered' : ''}</span>}
    options={[...page.map(model => ({ value: model.model, label: model.displayName || model.model,
      description: !model.available ? ready ? 'Codex is not ready.' : 'Loading Codex models…'
        : model.kind === 'literal' ? model.description : `${model.model}${model.description ? ` · ${model.description}` : ''}`,
      group: model.kind === 'literal' ? 'Model IDs' : 'Codex models', keywords: model.model, disabled: !model.available || !canChoose })),
    ...(literalChoice ? [{ value: query, label: `Use model ID “${query}”`, description: 'Metadata unavailable · service acceptance unverified.',
      group: 'Model IDs', disabled: !canChoose }] : [])]}
    remoteSearch={{ query, onQueryChange: value => { setQuery(value); setOffset(0); }, loading, error: error || undefined, onRetry: onRefresh,
      onPreviousPage: previous, onNextPage: next,
      footer: <>{inputNotice && <p className="field-help" role="status">{inputNotice}</p>}
        <PageNavigation label="Models" offset={pageOffset} count={page.length} total={filtered.length} hasPrevious={pageOffset > 0}
          hasNext={pageOffset + PAGE_SIZE < filtered.length} loading={loading} onPrevious={previous} onNext={next} /></> }} />;
}
