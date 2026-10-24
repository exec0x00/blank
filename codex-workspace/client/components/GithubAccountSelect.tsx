import { useEffect, useState } from 'react';
import { SelectMenu } from './ui/Dropdown';
import PageNavigation from './ui/PageNavigation';
import { useGithubAccountPage } from './useGithubAccountPage';
import './github-account-select.css';

interface Props {
  value: string;
  onValueChange: (value: string) => void;
  'aria-label': string;
  id?: string;
  disabled?: boolean;
  scope?: string;
  emptyValue?: string;
  emptyLabel?: string;
}

/** Saved accounts are searched on the server; the current selection never
 * depends on whether its row happens to be in the displayed account page. */
export default function GithubAccountSelect({ value, onValueChange, 'aria-label': label, id, disabled = false, scope = '', emptyValue = '', emptyLabel = 'No account selected' }: Props) {
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  useEffect(() => {
    const timer = window.setTimeout(() => setQuery(search.trim()), 200);
    return () => window.clearTimeout(timer);
  }, [search]);
  const selectedId = value === emptyValue ? '' : value;
  const accounts = useGithubAccountPage(query, selectedId, scope);
  const page = accounts.page;
  const selected = page?.selected?.id === selectedId ? page.selected : page?.accounts.find(account => account.id === selectedId);
  const pendingQuery = query !== search.trim();
  const loading = accounts.loading || pendingQuery;
  const selectionLabel = value === emptyValue ? emptyLabel : selected ? `@${selected.login}` : loading || !accounts.selectionChecked ? 'Loading saved account…' : 'Saved account unavailable';
  return <div className="github-account-select">
    <SelectMenu<string> id={id} value={value} onValueChange={onValueChange} aria-label={label} disabled={disabled}
      options={[{ value: emptyValue, label: emptyLabel, disabled: loading }, ...(!pendingQuery ? page?.accounts ?? [] : []).map(account => ({ value: account.id, label: `@${account.login}`, description: account.name || undefined, disabled: loading }))]}
      renderValue={() => selectionLabel} searchPlaceholder="Find a GitHub account…" onOpenChange={open => { if (open) accounts.reload(); }}
      remoteSearch={{ query: search, onQueryChange: value => setSearch(value.slice(0, 120)), loading, error: accounts.error,
        onRetry: accounts.retry, onPreviousPage: !loading && page?.previousCursor ? accounts.previous : undefined,
        onNextPage: !loading && page?.nextCursor ? accounts.next : undefined,
        footer: <PageNavigation label="GitHub accounts" offset={page?.offset ?? 0} count={page?.accounts.length ?? 0} total={page?.total}
          hasPrevious={!!page?.previousCursor} hasNext={!!page?.nextCursor} loading={loading} disabled={disabled}
          onPrevious={accounts.previous} onNext={accounts.next} /> }} />
    {accounts.error && <p className="github-account-select-error" role="alert">{accounts.error} <button type="button" className="button ghost" disabled={loading || disabled} onClick={accounts.retry}>Retry accounts</button></p>}
  </div>;
}
