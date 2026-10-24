import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import GithubPanel from '../../../client/components/GithubPanel';
import GithubAccountSelect from '../../../client/components/GithubAccountSelect';
import '../../../client/styles.css';
import '../../../client/scrollbars.css';

const root = createRoot(document.getElementById('root')!);
const signals: Array<{ path: string; signal: AbortSignal }> = [];
const events: Array<{ kind: string; value: unknown }> = [];
const original = window.fetch.bind(window);
window.fetch = (input, options) => {
  if (typeof input === 'string' && input.startsWith('/api/github/') && options?.signal) signals.push({ path: input, signal: options.signal });
  return original(input, options);
};

function Fixture() {
  const [mode, setMode] = useState(new URL(location.href).searchParams.get('mode') === 'selector' ? 'selector' : 'panel');
  const [selected, setSelected] = useState('gh_70');
  const [scope, setScope] = useState('workspace-one');
  const [shown, setShown] = useState(true);
  Object.assign(window, { githubListsFixture: {
    mode: setMode,
    selected: (id: string, nextScope = scope) => { setSelected(id); setScope(nextScope); },
    show: setShown,
    lock: () => { document.body.dataset.workspaceLocked = 'true'; window.dispatchEvent(new Event('codex:session-locked')); },
    unlock: () => { document.body.dataset.workspaceLocked = 'false'; window.dispatchEvent(new Event('codex:session-unlocked')); },
    state: () => ({ selected, events, signals: signals.map(item => ({ path: item.path, aborted: item.signal.aborted })) }),
  } });
  return <div style={{ display: shown ? undefined : 'none' }}>
    {mode === 'selector' ? <div style={{ width: 'min(330px, calc(100vw - 32px))', margin: 16 }}><GithubAccountSelect
      scope={scope} value={selected} onValueChange={value => { setSelected(value); events.push({ kind: 'selected', value }); }}
      aria-label="GitHub account fixture" /></div>
      : <GithubPanel onImported={value => events.push({ kind: 'imported', value })} onNotify={value => events.push({ kind: 'notice', value })} />}
  </div>;
}

root.render(<Fixture />);
